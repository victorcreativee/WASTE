import assert from "node:assert/strict";
import test from "node:test";
import { formatMessage } from "../src/services/notification-delivery";

test("household reminders read as the company's message with the household link", () => {
  const sms = formatMessage("sms", { category: "household", title: "Collection tomorrow", link: "/my",
    body: "Nabugabo joint: we collect your waste tomorrow, Tuesday 27 Oct. Please put it out in the morning." }, "https://kampalawms.com");
  assert.equal(sms.text, "Nabugabo joint: we collect your waste tomorrow, Tuesday 27 Oct. Please put it out in the morning. https://kampalawms.com/my");
  assert.ok(!sms.text.includes("KCCA WMS"));
});

test("long household reminders are shortened to fit two SMS, keeping the link", () => {
  const sms = formatMessage("sms", { category: "household", title: "Request resolved", link: "/my", body: "x".repeat(600) }, "https://kampalawms.com");
  assert.ok(sms.text.length <= 306);
  assert.ok(sms.text.endsWith("… https://kampalawms.com/my"));
});

test("staff SMS keep the platform prefix", () => {
  const sms = formatMessage("sms", { title: "Permit expiring", body: "Renew it.", link: "/dashboard/permit" }, "https://kampalawms.com");
  assert.ok(sms.text.startsWith("KCCA WMS: Permit expiring."));
});
