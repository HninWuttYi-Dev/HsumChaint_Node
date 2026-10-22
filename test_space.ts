import { createMonasteryService } from "./src/modules/space/space.service";

async function test() {
  try {
    const res = await createMonasteryService(2, { monasteryName: "Test Monastery" });
    console.log("Success:", res);
  } catch (e) {
    console.error("Caught error:", e);
  }
}
test();
