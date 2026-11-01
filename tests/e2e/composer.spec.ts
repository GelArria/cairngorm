import { test } from "./fixtures";

// The current ChatUIView has no attach (paperclip) or microphone controls;
// these tests targeted a removed composer. Re-enable when the features return.
test.describe("Composer controls", () => {
  test.fixme("attach file shows badge then removes it", async () => {
    // pending: attach control does not exist in ChatUIView
  });

  test.fixme("microphone toggles recording indicator", async () => {
    // pending: microphone control does not exist in ChatUIView
  });
});
