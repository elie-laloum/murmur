import { flow, task } from "../src/index.ts";

const inspect = task({
  key: "inspect",
  perform: () => ({ files: ["src/cart.ts"], issue: "negative quantity" }),
});
const plan = task({
  key: "plan",
  after: [inspect],
  perform: (context) =>
    `Validate quantity in ${context.value(inspect).files[0]}`,
});
const patch = task({
  key: "patch",
  after: [plan],
  perform: (context) => ({
    plan: context.value(plan),
    quantity: (value: number) => Math.max(0, value),
  }),
});
const verify = task({
  key: "verify",
  after: [patch],
  perform(context) {
    const { quantity } = context.value(patch);
    if (quantity(-2) !== 0 || quantity(3) !== 3)
      throw new Error("Quantity check failed");
    return { passed: 2 };
  },
});
const summary = task({
  key: "summary",
  after: [plan, verify],
  perform: (context) => ({
    plan: context.value(plan),
    ...context.value(verify),
  }),
});

const pipeline = flow("repair-cart", [inspect, plan, patch, verify, summary]);
console.log("Deterministic workflow demo. No model or container is used.");
const result = await pipeline.start({
  concurrency: 2,
  observe: (event) => console.log(JSON.stringify(event)),
});
result.unwrap();
console.log(JSON.stringify(result.value(summary), null, 2));
console.log(pipeline.diagram());
