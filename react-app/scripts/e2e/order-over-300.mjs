import { runOrderFlow } from "./order-flow.mjs";

await runOrderFlow({
  label: "滿 300 元訂金流程",
  unitPrice: 300,
  finalTotal: 350,
  expectedInitialStatus: "pending_deposit",
  paymentMethod: "transfer",
});
