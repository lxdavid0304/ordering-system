import { ArrowLeft } from "lucide-react";

const LINE_OFFICIAL_ACCOUNT_URL = "https://line.me/R/ti/p/@976hevst";

function returnToLineChat() {
  if (window.liff?.isInClient?.() && typeof window.liff.close === "function") {
    window.liff.close();
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.location.assign(LINE_OFFICIAL_ACCOUNT_URL);
}

export default function LineReturnButton({ className }) {
  return (
    <button
      type="button"
      className={className}
      aria-label="返回 LINE 聊天"
      title="返回 LINE 聊天"
      onClick={returnToLineChat}
    >
      <ArrowLeft size={20} aria-hidden="true" />
    </button>
  );
}
