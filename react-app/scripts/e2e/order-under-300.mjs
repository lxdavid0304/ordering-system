import { runOrderFlow } from "./order-flow.mjs";

await runOrderFlow({
  label: "未滿 300 元免訂金流程",
  unitPrice: 270,
  finalTotal: 278,
  expectedInitialStatus: "open",
  paymentMethod: "cash",
});
