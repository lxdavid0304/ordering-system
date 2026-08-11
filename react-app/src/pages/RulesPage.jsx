import { Banknote, CreditCard, MapPin, PackageCheck, ReceiptText } from "lucide-react";
import LineReturnButton from "../components/LineReturnButton";

const flow = [
  ["1", "送出訂單", "選擇交貨地點、確認商品與預估總額。"],
  ["2", "確認付款", "總額超過 300 元時，先以轉帳支付 50% 訂金。"],
  ["3", "採買與通知", "確認訂金後通知開始採買；商品全數備妥後，另以 LINE 通知交貨時間。"],
  ["4", "取貨完成", "依通知前往原選交貨地點取貨，並完成尾款。"],
];

export default function RulesPage() {
  return (
    <main className="rules-page">
      <header className="rules-header">
        <span className="rules-brand">Costco 代購</span>
        <LineReturnButton className="rules-back-link" />
      </header>

      <section className="rules-hero" aria-labelledby="rules-title">
        <span>ORDER GUIDE</span>
        <h1 id="rules-title">取貨與付款規則</h1>
        <p>送單前先確認規則；訂單狀態與取貨提醒會由 LINE 官方帳號主動通知。</p>
      </section>

      <section className="rules-flow" aria-label="訂購流程">
        {flow.map(([step, title, description]) => (
          <article key={step}>
            <strong>{step}</strong>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <section className="rules-details" aria-label="取貨與付款說明">
        <article>
          <MapPin size={28} aria-hidden="true" />
          <div>
            <h2>取貨方式</h2>
            <ul>
              <li>填單時請選擇交貨地點：明德樓、據德樓、蘊德樓或機車停車場；送出後無法自行更改。</li>
              <li>商品全數備妥後，LINE 會通知交貨地點與交貨時間。</li>
              <li>請以 LINE 最新交貨通知的時間與地點為準，並於指定時間前完成尾款與取貨。</li>
              <li>請依通知前往取貨；有尾款時，於取貨前依通知完成付款。</li>
            </ul>
          </div>
        </article>

        <article>
          <CreditCard size={28} aria-hidden="true" />
          <div>
            <h2>付款方式</h2>
            <ul>
              <li>訂單總額未超過 300 元：不需支付訂金，取貨時再付清全額。</li>
              <li>訂單總額超過 300 元：需先以轉帳支付 50% 訂金。</li>
              <li>完成轉帳後，須待管理者確認訂金入帳，訂單才會進入採買流程。</li>
              <li>剩餘尾款依 LINE 的交貨通知與訂單金額完成付款。</li>
            </ul>
          </div>
        </article>

        <article>
          <ReceiptText size={28} aria-hidden="true" />
          <div>
            <h2>金額與運費</h2>
            <ul>
              <li>送單頁顯示的是預估總額，實際金額以採買完成後的通知為準。</li>
              <li>熱門商品標示價格已含運費，不另加收運費；自填商品每件加收 20 元運費。</li>
              <li>若採買後實際金額調整，LINE 會通知更新後的訂單總額、已付訂金與待付尾款；請以最新通知為準。</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="rules-support" aria-label="聯絡方式">
        <div><PackageCheck size={26} aria-hidden="true" /><span>請以 LINE 訂單狀態通知為準。</span></div>
        <div><Banknote size={26} aria-hidden="true" /><span>付款或取貨有疑問，請直接傳訊息至官方 LINE。</span></div>
      </section>
    </main>
  );
}
