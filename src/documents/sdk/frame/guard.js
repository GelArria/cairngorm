// Served before any provider script. The CSP does not cover WebRTC, which could otherwise
// carry document data to the network, so the constructors are removed for good.
(() => {
  const names = [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "RTCDataChannel",
    "RTCIceCandidate",
    "RTCSessionDescription",
    "RTCRtpSender",
    "RTCRtpReceiver",
    "RTCRtpTransceiver",
  ];
  for (const name of names) {
    try {
      Object.defineProperty(window, name, {
        value: undefined,
        writable: false,
        configurable: false,
      });
    } catch {
      // Already absent in this engine.
    }
  }
})();
