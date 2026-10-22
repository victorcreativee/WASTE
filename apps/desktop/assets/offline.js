const byId = (id) => document.getElementById(id),
  loginPanel = byId("login-panel"),
  workspace = byId("workspace"),
  loginForm = byId("offline-login"),
  loginError = byId("login-error"),
  connection = byId("connection"),
  pending = byId("pending"),
  failed = byId("failed"),
  checked = byId("checked"),
  queue = byId("queue"),
  reference = byId("reference"),
  operations = byId("operations"),
  retry = byId("retry"),
  loginRetry = byId("login-retry"),
  logout = byId("logout"),
  notice = byId("notice"),
  welcome = byId("welcome"),
  updateStatus = byId("update-status"),
  updateCheck = byId("update-check"),
  updateDownload = byId("update-download"),
  updateInstall = byId("update-install");
const loginEyebrow = loginPanel.querySelector(".eyebrow"),
  loginLead = loginPanel.querySelector(".lead"),
  loginSubmit = loginForm.querySelector("button[type=submit]"),
  loginConnection = document.createElement("p");
document.title = "Kampala WMS";
loginEyebrow.textContent = "SECURE DESKTOP ACCESS";
loginLead.textContent =
  "Use the same work credentials online or offline. The first successful sign-in on this computer requires an internet connection.";
loginSubmit.textContent = "Sign in";
loginRetry.textContent = "Check connection";
loginConnection.className = "notice";
loginConnection.setAttribute("role", "status");
loginForm.before(loginConnection);
loginRetry.nextElementSibling.textContent =
  "Your password is never stored. Online access uses an encrypted server credential; offline verification uses a salted cryptographic hash.";
let session = null,
  snapshots = [],
  currentState = null;
function friendlyError(error) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const message = raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "")
    .trim();
  if (/first sign-in/i.test(message))
    return "This computer has not been verified yet. Start the Kampala WMS services, connect to the platform, and sign in online once. After that, offline sign-in will work with the same credentials.";
  if (/network|fetch|connect|unavailable|offline/i.test(message))
    return "The Kampala WMS platform is not available. Start or restore the platform services, then choose Try online connection.";
  return message || "Offline sign-in could not be completed.";
}
function escapeText(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}
function label(endpoint) {
  return endpoint
    .split("?")[0]
    .replace(/^\/api\/waste\//, "")
    .replaceAll("/", " › ")
    .replaceAll("-", " ");
}
function render(state) {
  currentState = state;
  loginConnection.textContent = state.online
    ? "Online — this sign-in will verify with the central platform and activate offline access."
    : "Offline — a previously activated account can sign in locally.";
  connection.textContent = state.online ? "Online" : "Offline";
  pending.textContent = state.pendingCount;
  failed.textContent = state.failedCount;
  checked.textContent = state.lastCheckedAt
    ? `Last checked ${new Date(state.lastCheckedAt).toLocaleString("en-GB")}`
    : "Checking connection…";
  queue.innerHTML = state.queue.length
    ? state.queue
        .map(
          (item) =>
            `<div class="item"><div><strong>${escapeText(label(item.endpoint))}</strong><small>${escapeText(item.method)} · ${escapeText(new Date(item.createdAt).toLocaleString("en-GB"))}</small></div><span class="status">${escapeText(item.status)}</span></div>`,
        )
        .join("")
    : "<div class='item'><span>No work is waiting to synchronize.</span></div>";
  renderUpdate(state);
}
function renderUpdate(state) {
  const labels = {
    idle: "Automatic update checks enabled",
    checking: "Checking for updates…",
    available: `Version ${state.availableVersion || "new"} is available`,
    downloading: `Downloading ${state.updateProgress || 0}%`,
    ready: `Version ${state.availableVersion || "new"} is ready to install`,
    current: `Version ${state.appVersion} is up to date`,
    error: state.updateError || "The last update check failed",
  };
  updateStatus.textContent = labels[state.updateStatus] || labels.idle;
  updateCheck.hidden = ["available", "ready"].includes(state.updateStatus);
  updateCheck.disabled = !state.online || ["checking", "downloading"].includes(state.updateStatus);
  updateDownload.hidden = state.updateStatus !== "available";
  updateInstall.hidden = state.updateStatus !== "ready";
}
function metric(term, value) {
  const dt = document.createElement("dt"),
    dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = String(value);
  return [dt, dd];
}
function card(title, subtitle, metrics, items = []) {
  const article = document.createElement("article"),
    heading = document.createElement("h3"),
    small = document.createElement("small"),
    dl = document.createElement("dl");
  article.className = "reference-card";
  heading.textContent = title;
  small.textContent = subtitle;
  article.append(heading, small);
  metrics.forEach(([term, value]) => dl.append(...metric(term, value)));
  article.append(dl);
  if (items.length) {
    const ul = document.createElement("ul");
    items.forEach(([left, right]) => {
      const li = document.createElement("li"),
        a = document.createElement("span"),
        b = document.createElement("span");
      a.textContent = left;
      b.textContent = right;
      b.className = "muted";
      li.append(a, b);
      ul.append(li);
    });
    article.append(ul);
  }
  return article;
}
function renderSnapshots(records) {
  snapshots = records;
  reference.replaceChildren();
  records.forEach((record) => {
    const data = record.data || {},
      updated = `Updated ${new Date(record.updatedAt).toLocaleString("en-GB")}`;
    if (record.key === "driver-route") {
      const stops = Array.isArray(data.stops) ? data.stops : [];
      const customers = stops.flatMap((stop) =>
        Array.isArray(stop.customer_stops) ? stop.customer_stops : [],
      );
      const remaining = customers.filter(
        (customer) => !["collected", "not_collected"].includes(customer.status),
      );
      reference.append(
        card(
          data.name || "Assigned route",
          updated,
          [
            ["Vehicle", data.plate_number || "Not assigned"],
            ["Customers", customers.length],
            ["Customers remaining", remaining.length],
          ],
          remaining
            .slice(0, 5)
            .map((customer) => [
              customer.customer_name || "Customer",
              customer.address || "Address unavailable",
            ]),
        ),
      );
    } else if (record.key === "recycling-field") {
      const materials = Array.isArray(data.materials)
        ? data.materials.filter((item) => item.active !== false)
        : [];
      const partners = Array.isArray(data.partners)
        ? data.partners.filter((item) => item.active !== false)
        : [];
      reference.append(
        card(
          data.organization?.name || "Recycling field workspace",
          updated,
          [
            ["Materials", materials.length],
            ["Suppliers", partners.length],
            [
              "Received today",
              `${Number(data.operations?.receivedTodayKg || 0).toLocaleString()} kg`,
            ],
          ],
          materials
            .slice(0, 5)
            .map((item) => [item.name || "Material", "Available"]),
        ),
      );
    } else if (record.key === "company-dashboard") {
      const summary = data.summary || {},
        staff = Array.isArray(data.staff) ? data.staff : [],
        invoices = Array.isArray(data.billing?.invoices)
          ? data.billing.invoices
          : [];
      const outstanding = invoices.reduce(
        (total, item) => total + Number(item.balance_ugx || 0),
        0,
      );
      reference.append(
        card(
          data.organization?.name || "Organization dashboard",
          updated,
          [
            ["Trips today", summary.jobs_today || 0],
            ["Active routes", summary.active_routes || 0],
            [
              "Service completion",
              `${summary.service_completion_percentage || 0}%`,
            ],
            ["Customers", summary.total_customers || 0],
            [
              "Active staff",
              staff.filter((item) => item.status === "active").length,
            ],
            ["Outstanding", `UGX ${outstanding.toLocaleString()}`],
          ],
          (summary.active_route_progress || [])
            .slice(0, 5)
            .map((route) => [
              route.name || "Route",
              `${route.completed_stop_count || 0}/${route.stop_count || 0} stops`,
            ]),
        ),
      );
    } else if (record.key === "platform-dashboard") {
      const summary = data.summary || {},
        organizations = Array.isArray(data.organizations)
          ? data.organizations
          : [];
      reference.append(
        card(
          "Kampala operations",
          updated,
          [
            ["Trips today", summary.jobs_today || 0],
            ["In progress", summary.active_routes || 0],
            ["Completed", summary.completed_jobs || 0],
            [
              "Licensed operators",
              organizations.filter((item) => item.is_active).length,
            ],
            ["Zones covered", summary.zones_covered || 0],
            ["Customers served", summary.total_customers || 0],
          ],
          (summary.recent_unresolved_issues || [])
            .slice(0, 5)
            .map((issue) => [
              issue.title || "Service issue",
              issue.status || "open",
            ]),
        ),
      );
    }
  });
  if (!reference.children.length) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent =
      "Connect once and open the relevant workspace to initialize offline reference data.";
    reference.append(empty);
  }
  renderOperations();
}
async function saveOffline(endpoint, body, method = "PATCH") {
  await window.kwmsDesktop.queueOffline({ endpoint, method, body });
  notice.textContent =
    "Saved securely in SQLite. This action will synchronize automatically.";
  render(await window.kwmsDesktop.getState());
}
function renderOperations() {
  operations.replaceChildren();
  const driver = snapshots.find((item) => item.key === "driver-route")?.data,
    recycling = snapshots.find((item) => item.key === "recycling-field")?.data,
    company = snapshots.find((item) => item.key === "company-dashboard")?.data,
    platform = snapshots.find(
      (item) => item.key === "platform-dashboard",
    )?.data;
  if (session?.roles.includes("driver") && driver)
    renderDriverOperations(driver);
  else if (
    session?.roles.some((role) =>
      [
        "recycling_collector",
        "recycling_sales",
        "recycling_field_manager",
      ].includes(role),
    ) &&
    recycling
  )
    renderRecyclingOperations(recycling);
  else if (session?.roles.includes("company_admin") && company)
    renderCompanyDashboard(company, recycling);
  else if (
    session?.roles.some((role) =>
      ["kcca_admin", "system_admin"].includes(role),
    ) &&
    platform
  )
    renderPlatformDashboard(platform);
  else {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent =
      "Your secure offline account is ready, but this role’s operational data has not been downloaded yet. Connect once and open your normal dashboard; Kampala WMS will then keep an encrypted offline copy on this computer.";
    operations.append(empty);
  }
}
function renderCompanyDashboard(data, recycling) {
  const summary = data.summary || {},
    box = document.createElement("div"),
    heading = document.createElement("h3"),
    description = document.createElement("p");
  box.className = "operation-card";
  heading.textContent = `${data.organization?.name || "Organization"} — offline command centre`;
  description.textContent = `${summary.completed_jobs || 0} of ${summary.jobs_today || 0} jobs completed today · ${summary.available_trucks || 0} vehicles ready · ${summary.active_drivers || 0} drivers active`;
  box.append(heading, description);
  operations.append(box);
  if (
    recycling &&
    session.roles.some((role) =>
      [
        "recycling_collector",
        "recycling_sales",
        "recycling_field_manager",
        "company_admin",
      ].includes(role),
    )
  )
    renderRecyclingOperations(recycling);
}
function renderPlatformDashboard(data) {
  const summary = data.summary || {},
    box = document.createElement("div"),
    heading = document.createElement("h3"),
    description = document.createElement("p");
  box.className = "operation-card";
  heading.textContent = "KCCA control room — offline overview";
  description.textContent = `${summary.jobs_today || 0} trips today · ${summary.active_routes || 0} in progress · ${summary.pending_citizen_issues || 0} resident issues · ${summary.unassigned_zones || 0} unassigned areas`;
  box.append(heading, description);
  operations.append(box);
}
function renderDriverOperations(route) {
  const box = document.createElement("div"),
    heading = document.createElement("h3");
  box.className = "operation-card";
  heading.textContent = `${route.name || "Assigned route"} — field actions`;
  box.append(heading);
  if (route.status === "assigned") {
    const start = document.createElement("button");
    start.textContent = "Start assigned route";
    start.addEventListener(
      "click",
      () => void saveOffline(`/api/waste/driver-routes/${route.id}/start`, {}),
    );
    box.append(start);
  }
  const customers = (Array.isArray(route.stops) ? route.stops : [])
    .flatMap((stop) =>
      Array.isArray(stop.customer_stops) ? stop.customer_stops : [],
    )
    .filter((customer) => !["completed", "skipped"].includes(customer.status));
  customers.forEach((customer) => {
    const row = document.createElement("div"),
      text = document.createElement("div"),
      title = document.createElement("strong"),
      address = document.createElement("small"),
      collected = document.createElement("button"),
      missed = document.createElement("button");
    row.className = "customer-action";
    title.textContent = customer.customer_name || "Customer";
    address.textContent = customer.address || "Address unavailable";
    text.append(title, address);
    collected.textContent = "Collected";
    missed.textContent = "Could not collect";
    collected.addEventListener("click", async () => {
      const weight = window.prompt("Collected weight in kg (optional)", "");
      await saveOffline(`/api/waste/customer-collection-stops/${customer.id}`, {
        action: "complete",
        collectedWeightKg: weight ? Number(weight) : undefined,
      });
    });
    missed.addEventListener("click", async () => {
      const reason = window.prompt(
        "Reason collection could not be completed",
        "blocked_access",
      );
      if (reason)
        await saveOffline(
          `/api/waste/customer-collection-stops/${customer.id}`,
          { action: "skip", exceptionReason: reason },
        );
    });
    row.append(text, collected, missed);
    box.append(row);
  });
  operations.append(box);
}
function addField(form, labelText, name, type = "text", options = []) {
  const label = document.createElement("label");
  label.textContent = labelText;
  let control;
  if (type === "select") {
    control = document.createElement("select");
    options.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      control.append(option);
    });
  } else {
    control = document.createElement("input");
    control.type = type;
  }
  control.name = name;
  control.required = true;
  label.append(control);
  form.append(label);
  return control;
}
function renderRecyclingOperations(data) {
  const box = document.createElement("div"),
    heading = document.createElement("h3"),
    form = document.createElement("form");
  box.className = "operation-card";
  heading.textContent = "Record material purchase";
  form.className = "operation-form";
  const materials = (data.materials || []).filter(
      (item) => item.active !== false,
    ),
    partners = (data.partners || []).filter((item) => item.active !== false);
  const material = addField(
      form,
      "Material",
      "materialType",
      "select",
      materials.map((item) => [item.name, item.name]),
    ),
    supplier = addField(form, "Supplier", "supplierPartnerId", "select", [
      ["", "Choose supplier"],
      ...partners.map((item) => [item.id, item.name]),
    ]);
  addField(form, "Source or collection point", "sourceName");
  addField(form, "Quantity (kg)", "quantityKg", "number");
  addField(form, "Price per kg (UGX)", "unitPurchasePriceUgx", "number");
  const date = addField(form, "Purchase date", "collectedOn", "date");
  date.value = new Date().toISOString().slice(0, 10);
  const quality = addField(form, "Quality", "quality", "select", [
    ["mixed", "Mixed"],
    ["clean", "Clean"],
    ["sorted", "Sorted"],
  ]);
  quality.value = "mixed";
  const payment = addField(
    form,
    "Payment status",
    "purchasePaymentStatus",
    "select",
    [
      ["paid", "Paid"],
      ["credit", "Credit"],
    ],
  );
  payment.value = "paid";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Save purchase offline";
  submit.className = "full";
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const values = new FormData(form);
      await saveOffline(
        "/api/waste/recycling/lots",
        {
          materialType: material.value,
          allowNewMaterial: false,
          supplierPartnerId: supplier.value || undefined,
          sourceName: values.get("sourceName"),
          quantityKg: Number(values.get("quantityKg")),
          unitPurchasePriceUgx: Number(values.get("unitPurchasePriceUgx")),
          collectedOn: values.get("collectedOn"),
          quality: values.get("quality"),
          purchasePaymentStatus: values.get("purchasePaymentStatus"),
          workerWagesUgx: 0,
          foodUgx: 0,
          transportUgx: 0,
          driverFeeUgx: 0,
          otherExpenseUgx: 0,
          managerFloatUsedUgx: 0,
        },
        "POST",
      );
      form.reset();
      date.value = new Date().toISOString().slice(0, 10);
    } catch (error) {
      notice.textContent =
        error instanceof Error ? error.message : "Could not save purchase";
    } finally {
      submit.disabled = false;
    }
  });
  box.append(heading, form);
  operations.append(box);
  if (session.roles.includes("recycling_field_manager")) {
    const floatBox = document.createElement("div"),
      floatHeading = document.createElement("h3"),
      floatForm = document.createElement("form");
    floatBox.className = "operation-card";
    floatHeading.textContent = `Employee field float · UGX ${Number(data.summary?.floatBalanceUgx || 0).toLocaleString()} available`;
    floatForm.className = "operation-form";
    const floatDate = addField(floatForm, "Date", "transactionDate", "date");
    floatDate.value = new Date().toISOString().slice(0, 10);
    addField(floatForm, "Movement", "transactionType", "select", [
      ["given", "Money issued to employees"],
      ["spent", "Field expense reconciled"],
    ]);
    addField(floatForm, "Amount (UGX)", "amountUgx", "number");
    addField(floatForm, "Purpose / employee", "notes");
    const floatSubmit = document.createElement("button");
    floatSubmit.type = "submit";
    floatSubmit.textContent = "Save float movement offline";
    floatSubmit.className = "full";
    floatForm.append(floatSubmit);
    floatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      floatSubmit.disabled = true;
      try {
        const values = new FormData(floatForm);
        await saveOffline(
          "/api/waste/recycling/manager-float",
          {
            transactionDate: values.get("transactionDate"),
            transactionType: values.get("transactionType"),
            amountUgx: Number(values.get("amountUgx")),
            notes: values.get("notes"),
          },
          "POST",
        );
        floatForm.reset();
        floatDate.value = new Date().toISOString().slice(0, 10);
      } catch (error) {
        notice.textContent =
          error instanceof Error
            ? error.message
            : "Could not save float movement";
      } finally {
        floatSubmit.disabled = false;
      }
    });
    floatBox.append(floatHeading, floatForm);
    operations.append(floatBox);
  }
}
async function openWorkspace(localSession) {
  session = localSession;
  loginPanel.hidden = true;
  workspace.hidden = false;
  welcome.textContent = `Welcome, ${session.user.fullName}`;
  render(await window.kwmsDesktop.getState());
  renderSnapshots(await window.kwmsDesktop.getSnapshots());
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.style.display = "none";
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Signing in…";
  try {
    const state = await window.kwmsDesktop.getState();
    if (state.online) {
      await window.kwmsDesktop.centralLogin(
        byId("email").value,
        byId("password").value,
      );
      loginConnection.textContent = "Verified. Opening your workspace…";
    } else {
      await openWorkspace(
        await window.kwmsDesktop.offlineLogin(
          byId("email").value,
          byId("password").value,
        ),
      );
      loginForm.reset();
    }
  } catch (error) {
    loginError.textContent = friendlyError(error);
    loginError.style.display = "block";
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Sign in";
  }
});
async function reconnect(button) {
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    render(await window.kwmsDesktop.reconnect());
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent =
        button === loginRetry ? "Check connection" : "Try connection again";
    }, 1500);
  }
}
retry.addEventListener("click", () => void reconnect(retry));
loginRetry.addEventListener("click", () => void reconnect(loginRetry));
updateCheck.addEventListener("click", async () => {
  try { render(await window.kwmsDesktop.checkForUpdates()); }
  catch (error) { notice.textContent = friendlyError(error); }
});
updateDownload.addEventListener("click", async () => {
  try { render(await window.kwmsDesktop.downloadUpdate()); }
  catch (error) { notice.textContent = friendlyError(error); }
});
updateInstall.addEventListener("click", async () => {
  try { await window.kwmsDesktop.installUpdate(); }
  catch (error) { notice.textContent = friendlyError(error); }
});
logout.addEventListener("click", async () => {
  await window.kwmsDesktop.offlineLogout();
  session = null;
  snapshots = [];
  workspace.hidden = true;
  loginPanel.hidden = false;
  notice.textContent = "";
});
window.kwmsDesktop.onState(render);
void window.kwmsDesktop.getState().then(render);
