const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { setOpeningBalance, findFinancialPosition, updateExpenseStatus } = require('../src/repositories/expense.repository');
const { payBill } = require('../src/repositories/payables.repository');
const { createPeriod, saveLine, changePeriodStatus } = require('../../auth-service/src/repositories/payroll.repository');

module.exports = async ({ client, one, organization, user, check, request }) => {
  const { today, yesterday, tomorrow } = await one("SELECT CURRENT_DATE::text today,(CURRENT_DATE-1)::text yesterday,(CURRENT_DATE+1)::text tomorrow");
  const expectConflict = async (operation, label) => {
    await assert.rejects(operation, error => error.statusCode === 409); check(true, label);
  };
  const org = await organization('Rollback finance history'), admin = await user(org,'company_admin');
  await client.query("INSERT INTO organization_expenses(organization_id,expense_number,category,description,amount_ugx,expense_date,status,paid_at,created_by) VALUES($1,$2,'office','Prior-day rollback expense',100,CURRENT_DATE-1,'paid',CURRENT_TIMESTAMP-INTERVAL '1 day',$3)",[org,randomUUID(),admin]);
  const before=await findFinancialPosition(org);
  check(Number(before.cash_position_ugx)===-100,'Unconfigured cash includes prior-day payments');
  check(before.opening_balance_configured===false,'Unset opening state is explicit');
  await expectConflict(()=>setOpeningBalance(org,admin,{openingBalanceUgx:1000,asOfDate:tomorrow}),'Future opening date rejected');
  await expectConflict(()=>setOpeningBalance(org,admin,{openingBalanceUgx:1000,asOfDate:today}),'Opening cutoff cannot hide existing payment');
  await setOpeningBalance(org,admin,{openingBalanceUgx:1000,asOfDate:yesterday});
  const position=await findFinancialPosition(org);
  check(Number(position.cash_position_ugx)===900,'Opening and prior-day expense reconcile');
  check(position.opening_balance_locked===true,'Existing cash activity locks opening balance');
  check(position.opening_balance_history.length===1,'Initial setting has one history event');
  const httpPosition=await request(admin,'/api/waste/finance/position');
  check(httpPosition.status===200 && httpPosition.body.data.opening_balance_locked===true && httpPosition.body.data.opening_balance_history.length===1,'Financial-position API exposes locked state and history');
  const httpOpening=await request(admin,'/api/waste/finance/position/opening-balance','PUT',{openingBalanceUgx:2000,asOfDate:yesterday});
  check(httpOpening.status===409 && httpOpening.body.message.includes('locked'),'Opening API returns a readable conflict');
  await expectConflict(()=>setOpeningBalance(org,admin,{openingBalanceUgx:2000,asOfDate:yesterday}),'Posted opening balance cannot be replaced');
  await setOpeningBalance(org,admin,{openingBalanceUgx:1000,asOfDate:yesterday});
  check((await findFinancialPosition(org)).opening_balance_history.length===1,'Identical save does not duplicate history');
  const b=await organization('Rollback payroll controls'), owner=await user(b,'company_admin'), staff=await user(b,'driver');
  await setOpeningBalance(b,owner,{openingBalanceUgx:5000,asOfDate:today});
  const period=await createPeriod(b,owner,{name:'Rollback payroll',startsOn:today,endsOn:today,payDate:today});
  check(!!period,'Payroll period created');
  check(await createPeriod(b,owner,{name:'Overlap',startsOn:today,endsOn:tomorrow,payDate:tomorrow})===null,'Overlapping period rejected');
  const line={userId:staff,basicPayUgx:5800,allowanceUgx:0,deductionUgx:0};
  check(!!await saveLine(b,period.id,line),'Draft payroll editable');
  check(await changePeriodStatus(b,owner,period.id,'approved')===null,'5800 payroll cannot be approved with 5000 cash');
  await saveLine(b,period.id,{...line,basicPayUgx:4000});
  check(!!await changePeriodStatus(b,owner,period.id,'approved'),'Funded payroll approval succeeds');
  check(await saveLine(b,period.id,{...line,basicPayUgx:5800})===null,'Approved payroll amount cannot change');
  check(Number((await findFinancialPosition(b)).available_to_commit_ugx)===1000,'Approved payroll reserves funds');
  await expectConflict(()=>setOpeningBalance(b,owner,{openingBalanceUgx:3000,asOfDate:today}),'Opening reduction cannot underfund commitments');
  check(Number((await findFinancialPosition(b)).opening_balance_ugx)===5000,'Rejected opening update rolled back');
  check((await findFinancialPosition(b)).opening_balance_history.length===1,'Rejected change has no history event');
  await setOpeningBalance(b,owner,{openingBalanceUgx:6000,asOfDate:today});
  check((await findFinancialPosition(b)).opening_balance_history.length===2,'Pre-posting correction is recorded');
  check(!!await changePeriodStatus(b,owner,period.id,'paid'),'Approved payroll pays exactly once');
  check(await changePeriodStatus(b,owner,period.id,'paid')===null,'Duplicate payroll payment rejected');
  check(Number((await findFinancialPosition(b)).cash_position_ugx)===2000,'Payroll deducts cash once');
  await expectConflict(()=>setOpeningBalance(b,owner,{openingBalanceUgx:7000,asOfDate:today}),'Payroll payment locks opening setting');
  const supplier=await one("INSERT INTO suppliers(organization_id,name) VALUES($1,'Rollback supplier') RETURNING id",[b]);
  const bill=await one("INSERT INTO supplier_bills(organization_id,bill_number,supplier_id,description,amount_ugx,balance_ugx,issued_on,due_on,created_by) VALUES($1,$2,$3,'Rollback bill',1500,1500,CURRENT_DATE,CURRENT_DATE,$4) RETURNING id",[b,randomUUID(),supplier.id,owner]);
  const payment={amountUgx:1000,paymentMethod:'cash',reference:'B-ONE',paidOn:today};
  await expectConflict(()=>payBill(b,owner,bill.id,{...payment,paidOn:yesterday}),'Payment before opening cutoff rejected');
  await expectConflict(()=>payBill(b,owner,bill.id,{...payment,paidOn:tomorrow}),'Future supplier payment rejected');
  const httpPayment=await request(owner,'/api/waste/finance/payables/bills/'+bill.id+'/payments','POST',{...payment,paidOn:yesterday});
  check(httpPayment.status===409 && httpPayment.body.message.includes('Payment date'),'Supplier API returns a readable date conflict');
  check(Number((await one('SELECT balance_ugx FROM supplier_bills WHERE id=$1',[bill.id])).balance_ugx)===1500,'Invalid dates preserve bill balance');
  check(!!await payBill(b,owner,bill.id,payment),'Valid supplier payment succeeds');
  check(Number((await findFinancialPosition(b)).cash_position_ugx)===1000,'Supplier payment reduces cash');
  check(await payBill(b,owner,bill.id,{...payment,amountUgx:500})===null,'Duplicate supplier reference rejected');
  const expense=await one("INSERT INTO organization_expenses(organization_id,expense_number,category,description,amount_ugx,expense_date,created_by) VALUES($1,$2,'office','Rollback expense',600,CURRENT_DATE,$3) RETURNING id",[b,randomUUID(),owner]);
  check(await updateExpenseStatus(expense.id,b,owner,'approved')===null,'Supplier liability leaves only 500 available; 600 approval rejected');

  // Independent real database session holds the finance lock. Each production writer
  // must wait, then continue only after that session releases it. No fixtures committed.
  const mainPid=(await one('SELECT pg_backend_pid() pid')).pid;
  for(const operationName of ['period','line','approval','opening','supplier']){
    const tenant=await organization('Rollback lock '+operationName), actor=await user(tenant,'company_admin');
    const payroll=await one("INSERT INTO payroll_periods(organization_id,name,starts_on,ends_on,pay_date,created_by) VALUES($1,'Lock test',CURRENT_DATE,CURRENT_DATE,CURRENT_DATE,$2) RETURNING id",[tenant,actor]);
    const blocker=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
    await blocker.connect();
    let pending;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))',['finance:'+tenant]);
      const operation=operationName==='period'?()=>createPeriod(tenant,actor,{name:'Lock period',startsOn:tomorrow,endsOn:tomorrow,payDate:tomorrow})
        :operationName==='line'?()=>saveLine(tenant,payroll.id,{userId:actor,basicPayUgx:100,allowanceUgx:0,deductionUgx:0})
        :operationName==='approval'?()=>changePeriodStatus(tenant,actor,payroll.id,'approved')
        :operationName==='opening'?()=>setOpeningBalance(tenant,actor,{openingBalanceUgx:1000,asOfDate:today})
        :()=>payBill(tenant,actor,randomUUID(),payment);
      pending=operation();
      let waiting=false;
      for(let i=0;i<40;i++){
        const state=await blocker.query('SELECT cardinality(pg_blocking_pids($1))>0 waiting',[mainPid]);
        if(state.rows[0].waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      check(waiting,operationName+' writer waits on shared finance lock');
    } finally {
      await blocker.query('ROLLBACK');
      if(pending) await pending;
      await blocker.end();
    }
  }
  console.log('PASS: finance baseline, history, supplier cutoff, payroll safety, and five cross-session lock checks.');
};
