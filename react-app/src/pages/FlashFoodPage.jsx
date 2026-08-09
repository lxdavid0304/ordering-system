import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, House, MapPin, Minus, Package, Plus, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { loadMemberFlashFoodCampaigns, saveMemberFlashFoodOrder } from "../services/flashFoodService";
import {
  calculateFlashFoodAmounts,
  FLASH_FOOD_SHIPPING_FEE,
  flashFoodMenu,
  flashFoodPickupLocations,
  formatFlashFoodDateTime,
  getFlashFoodProductMeta,
  getFlashFoodCampaignState,
  withFlashFoodTotal,
} from "../utils/flashFood";
import { formatCurrency } from "../utils/format";

function makeInitialQuantities(campaign) {
  const quantities = {};
  (campaign.member_order?.flash_food_order_items || []).forEach((item) => {
    if (item.campaign_item_id) quantities[item.campaign_item_id] = Number(item.quantity) || 0;
  });
  return quantities;
}

function CampaignRail({ campaigns, selectedId, onSelect, clock }) {
  const now = new Date(clock);
  const currentCampaign = campaigns.find((campaign) => getFlashFoodCampaignState(campaign, now) === "open");
  const upcomingCampaign = campaigns.find((campaign) => getFlashFoodCampaignState(campaign, now) === "scheduled");

  return (
    <aside className="flash-food-campaign-rail" aria-label="快閃活動">
      <div className="flash-food-rail-head">
        <span>FLASH FOOD TIME</span>
        <h2>開團時間</h2>
      </div>
      {currentCampaign || upcomingCampaign ? (
        <div className="flash-food-rail-status" aria-label="目前與即將開團時間">
          {currentCampaign ? (
            <button type="button" className={`flash-food-rail-status-card open${selectedId === currentCampaign.id ? " selected" : ""}`} onClick={() => onSelect(currentCampaign.id)}>
              <span>當下開團</span>
              <strong>{currentCampaign.title}</strong>
              <small><CalendarClock size={13} aria-hidden="true" /> 開放 {formatFlashFoodDateTime(currentCampaign.open_at)}</small>
              <small><Clock3 size={13} aria-hidden="true" /> 截止 {formatFlashFoodDateTime(currentCampaign.deadline_at)}</small>
              <small><MapPin size={13} aria-hidden="true" /> 預估取餐 {formatFlashFoodDateTime(currentCampaign.pickup_start_at)} 至 {formatFlashFoodDateTime(currentCampaign.pickup_end_at)}</small>
            </button>
          ) : null}
          {upcomingCampaign ? (
            <div className="flash-food-rail-status-card scheduled">
              <span>即將開團</span>
              <strong>{upcomingCampaign.title}</strong>
              <small><CalendarClock size={13} aria-hidden="true" /> {formatFlashFoodDateTime(upcomingCampaign.open_at)} 開放</small>
              <small><Clock3 size={13} aria-hidden="true" /> 截止 {formatFlashFoodDateTime(upcomingCampaign.deadline_at)}</small>
              <small><MapPin size={13} aria-hidden="true" /> 預估取餐 {formatFlashFoodDateTime(upcomingCampaign.pickup_start_at)} 至 {formatFlashFoodDateTime(upcomingCampaign.pickup_end_at)}</small>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flash-food-rail-empty flash-food-rail-awaiting">
          <strong>敬請期待</strong>
          <p>目前沒有開放或即將開團的快閃熱食活動。</p>
        </div>
      )}
    </aside>
  );
}

const mobileFoodMenuGroups = [
  { id: "hot", label: "熱食", categories: ["熱食", "熱湯"] },
  { id: "meal", label: "主餐", categories: ["飯食", "輕食"] },
  { id: "pizza", label: "披薩", categories: ["披薩"] },
  { id: "drink", label: "飲品", categories: ["飲品"] },
];

function FoodMenuCards({ items, campaign, quantities, onQuantityChange, locked }) {
  return items.map((item) => {
    const quantity = Math.max(0, Number(quantities[item.id]) || 0);
    const unitEstimate = Number(item.unit_price) + Number(campaign?.shipping_fee_per_unit || FLASH_FOOD_SHIPPING_FEE);
    const product = getFlashFoodProductMeta(item.product_name);
    return (
      <article className={`flash-food-item flash-food-product-card tone-${product.tone}`} key={item.id || item.product_name}>
        <div className="flash-food-product-card-top">
          <span className="flash-food-product-icon" aria-hidden="true">{product.icon}</span>
          <span className="flash-food-product-category">{product.category}</span>
        </div>
        <div className="flash-food-product-copy">
          <h3>{item.product_name}</h3>
          {item.item_note ? <span>{item.item_note}</span> : null}
        </div>
        <div className="flash-food-item-action">
          <div>
            <span className="flash-food-price-label">含運價</span>
            <strong>${formatCurrency(unitEstimate)}</strong>
          </div>
          <div className="flash-quantity-control">
            <button type="button" disabled={locked || quantity <= 0} aria-label={`減少 ${item.product_name}`} onClick={() => onQuantityChange(item.id, quantity - 1)}><Minus size={15} /></button>
            <span>{quantity}</span>
            <button type="button" disabled={locked} aria-label={`增加 ${item.product_name}`} onClick={() => onQuantityChange(item.id, quantity + 1)}><Plus size={15} /></button>
          </div>
        </div>
        <p className="flash-food-product-price-note">現場價 ${formatCurrency(item.unit_price)} ＋ 運費 ${formatCurrency(campaign?.shipping_fee_per_unit || FLASH_FOOD_SHIPPING_FEE)}</p>
      </article>
    );
  });
}

function FoodMenuGrid({ items, campaign, quantities, onQuantityChange, locked = false }) {
  const [selectedMobileGroup, setSelectedMobileGroup] = useState("hot");
  const groupedItems = mobileFoodMenuGroups.map((group) => ({
    ...group,
    items: items.filter((item) => group.categories.includes(getFlashFoodProductMeta(item.product_name).category)),
  })).filter((group) => group.items.length);

  return (
    <section className="flash-food-menu-board" aria-label="熱食菜單">
      <div className="flash-food-menu-board-head">
        <div>
          <span>FOOD COURT MENU</span>
          <h2>選擇想吃的餐點</h2>
        </div>
        {campaign ? <p>顯示價格已含運費；點完後在下方確認。</p> : <p>活動開放後即可在此選餐。</p>}
      </div>
      <div className="flash-food-item-grid flash-food-global-menu-grid flash-food-desktop-grid">
        <FoodMenuCards items={items} campaign={campaign} quantities={quantities} onQuantityChange={onQuantityChange} locked={locked} />
      </div>
      <div className="flash-food-mobile-menu-groups">
        <div className="flash-food-mobile-menu-tabs" role="tablist" aria-label="餐點分類">
          {groupedItems.map((group) => {
            const selectedCount = group.items.reduce((sum, item) => sum + Math.max(0, Number(quantities[item.id]) || 0), 0);
            const isSelected = selectedMobileGroup === group.id;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={isSelected ? "selected" : ""}
                key={group.id}
                onClick={() => setSelectedMobileGroup(group.id)}
              >
                <span>{group.label}</span>
                {selectedCount ? <small>已選 {selectedCount}</small> : null}
              </button>
            );
          })}
        </div>
        {groupedItems.map((group) => (
          group.id === selectedMobileGroup ? (
            <div className="flash-food-item-grid flash-food-mobile-menu-grid" key={group.id} role="tabpanel">
              <FoodMenuCards items={group.items} campaign={campaign} quantities={quantities} onQuantityChange={onQuantityChange} locked={locked} />
            </div>
          ) : null
        ))}
      </div>
    </section>
  );
}

function OrderBoard({ campaign, quantities, pickupLocation, note, onQuantityChange, onPickupLocationChange, onNoteChange, onSubmit, saving }) {
  const items = (campaign.flash_food_campaign_items || []).filter((item) => item.is_active);
  const amounts = withFlashFoodTotal(calculateFlashFoodAmounts(items, quantities, campaign.shipping_fee_per_unit));
  const selectedItems = items.filter((item) => Number(quantities[item.id]) > 0);
  const submitted = campaign.member_order;

  return (
    <section className="flash-food-order-board" id="flash-food-order-board" aria-label="點餐統計">
      <div className="flash-food-order-selection">
        <span>YOUR PICKS</span>
        <h2>本次點餐</h2>
        <label className="flash-food-pickup-select flash-food-mobile-cart-location">
          <span className="flash-food-pickup-label">
            <span className="flash-food-pickup-icon" aria-hidden="true">
              <House size={16} strokeWidth={2.4} />
              <Package size={9} strokeWidth={2.8} />
            </span>
            交貨地點
          </span>
          <select value={pickupLocation} onChange={(event) => onPickupLocationChange(event.target.value)}>
            <option value="">請選擇交貨地點</option>
            {flashFoodPickupLocations.map((location) => <option value={location} key={location}>{location}</option>)}
          </select>
        </label>
        {selectedItems.length ? (
          <ul>
            {selectedItems.map((item) => {
              const quantity = Number(quantities[item.id]);
              return (
                <li key={item.id}>
                  <span>{item.product_name} <b>× {quantity}</b></span>
                  <div className="flash-food-order-item-actions">
                    <div className="flash-quantity-control" aria-label={`${item.product_name} 數量`}>
                      <button type="button" disabled={quantity <= 0} aria-label={`減少 ${item.product_name}`} onClick={() => onQuantityChange(item.id, quantity - 1)}><Minus size={14} /></button>
                      <span>{quantity}</span>
                      <button type="button" aria-label={`增加 ${item.product_name}`} onClick={() => onQuantityChange(item.id, quantity + 1)}><Plus size={14} /></button>
                    </div>
                    <button type="button" className="flash-food-order-remove" aria-label={`刪除 ${item.product_name}`} onClick={() => onQuantityChange(item.id, 0)}><Trash2 size={15} /></button>
                    <strong>${formatCurrency((Number(item.unit_price) + Number(campaign.shipping_fee_per_unit)) * quantity)}</strong>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="flash-food-order-empty">先從上方菜單挑選餐點。</p>}
      </div>
      <div className="flash-food-order-total">
        <dl>
          <div className="flash-food-total-row"><dt>餐點總額（已含運費）</dt><dd>${formatCurrency(amounts.total)}</dd></div>
        </dl>
      </div>
      <div className="flash-food-submit">
        {submitted ? <p className="flash-food-edit-note">已送出點餐；截止前可調整品項、數量與交貨地點後，再按下更新。</p> : null}
        <textarea value={note} rows="2" onChange={(event) => onNoteChange(event.target.value)} placeholder="點餐備註（選填）" />
        <button type="button" disabled={saving || !amounts.quantity || !pickupLocation} onClick={onSubmit}>
          <ShoppingBag size={17} aria-hidden="true" />
          {saving ? "送出中…" : submitted ? "更新我的點餐" : "送出我的點餐"}
        </button>
      </div>
    </section>
  );
}

function EmptyMenu() {
  return <FoodMenuGrid items={flashFoodMenu} campaign={null} quantities={{}} onQuantityChange={() => {}} locked />;
}

export default function FlashFoodPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [quantitiesByCampaign, setQuantitiesByCampaign] = useState({});
  const [pickupLocationsByCampaign, setPickupLocationsByCampaign] = useState({});
  const [notesByCampaign, setNotesByCampaign] = useState({});
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCampaignId, setSavingCampaignId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [clock, setClock] = useState(Date.now());

  async function refreshCampaigns() {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await loadMemberFlashFoodCampaigns(user.id);
    if (error) {
      setCampaigns([]);
      setMessage({ text: error.message || "讀取快閃熱食失敗。", type: "error" });
    } else {
      setCampaigns(data || []);
      setQuantitiesByCampaign((current) => {
        const next = { ...current };
        (data || []).forEach((campaign) => {
          if (!Object.prototype.hasOwnProperty.call(next, campaign.id)) next[campaign.id] = makeInitialQuantities(campaign);
        });
        return next;
      });
      setNotesByCampaign((current) => {
        const next = { ...current };
        (data || []).forEach((campaign) => {
          if (!Object.prototype.hasOwnProperty.call(next, campaign.id)) next[campaign.id] = campaign.member_order?.note || "";
        });
        return next;
      });
      setPickupLocationsByCampaign((current) => {
        const next = { ...current };
        (data || []).forEach((campaign) => {
          if (!Object.prototype.hasOwnProperty.call(next, campaign.id)) next[campaign.id] = campaign.member_order?.pickup_location || "";
        });
        return next;
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    document.title = "快閃熱食｜Costco 代購";
    refreshCampaigns();
  }, [user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const displayCampaigns = useMemo(
    () => [...campaigns].sort((left, right) => new Date(left.deadline_at) - new Date(right.deadline_at)),
    [campaigns]
  );
  const openCampaigns = useMemo(
    () => displayCampaigns.filter((campaign) => getFlashFoodCampaignState(campaign, new Date(clock)) === "open"),
    [displayCampaigns, clock]
  );
  const railCampaigns = useMemo(
    () => displayCampaigns.filter((campaign) => {
      const state = getFlashFoodCampaignState(campaign, new Date(clock));
      return state === "open" || state === "scheduled";
    }),
    [displayCampaigns, clock]
  );
  const selectedCampaign = openCampaigns.find((campaign) => campaign.id === selectedCampaignId) || openCampaigns[0] || null;
  useEffect(() => {
    if (selectedCampaign && selectedCampaign.id !== selectedCampaignId) setSelectedCampaignId(selectedCampaign.id);
  }, [selectedCampaign?.id, selectedCampaignId]);

  function changeQuantity(campaignId, itemId, quantity) {
    setQuantitiesByCampaign((current) => ({
      ...current,
      [campaignId]: { ...(current[campaignId] || {}), [itemId]: Math.max(0, quantity) },
    }));
  }

  async function submitCampaign(campaign) {
    const items = Object.entries(quantitiesByCampaign[campaign.id] || {})
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([campaign_item_id, quantity]) => ({ campaign_item_id, quantity: Number(quantity) }));
    if (!items.length) return;
    const pickupLocation = pickupLocationsByCampaign[campaign.id] || "";
    if (!pickupLocation) {
      setMessage({ text: "請選擇交貨地點。", type: "error" });
      return;
    }
    setSavingCampaignId(campaign.id);
    setMessage({ text: "正在送出點餐…", type: "" });
    const { error, notificationError } = await saveMemberFlashFoodOrder(campaign.id, pickupLocation, items, notesByCampaign[campaign.id] || "");
    setSavingCampaignId("");
    if (error) {
      const text = String(error.message || "");
      const humanMessage = text.includes("Campaign is locked")
        ? "此團已截止，無法再修改。"
        : text.includes("Member profile required")
          ? "請先完成會員資料後，再送出點餐。"
          : text || "送出點餐失敗。";
      setMessage({ text: humanMessage, type: "error" });
      await refreshCampaigns();
      return;
    }
    setMessage({ text: notificationError ? "點餐已儲存，但 LINE 通知尚未送達。" : "點餐已儲存，LINE 已通知最新品項；截止前仍可調整。", type: notificationError ? "error" : "success" });
    await refreshCampaigns();
  }

  return (
    <MemberLayout title="快閃熱食" active="flash-food" pageClassName="flash-food-page">
      <section className="flash-food-hero">
        <div>
          <span>FLASH FOOD COURT</span>
          <h1>在忙碌的日子裡，<br />也能好好吃一頓飯。</h1>
          <p>一份溫暖的日常，在剛好的時候等你。</p>
        </div>
        <UtensilsCrossed size={46} aria-hidden="true" />
      </section>

      <section className="flash-food-content" aria-label="快閃熱食活動">
        <FormMessage text={message.text} type={message.type} />
        {loading ? <p className="flash-food-empty">正在讀取活動…</p> : null}
        {!loading ? (
          <>
            <div className="flash-food-workspace">
              <div className="flash-food-main-column">
              {selectedCampaign ? (
                <>
                  <FoodMenuGrid
                    items={(selectedCampaign.flash_food_campaign_items || []).filter((item) => item.is_active)}
                    campaign={selectedCampaign}
                    quantities={quantitiesByCampaign[selectedCampaign.id] || {}}
                    onQuantityChange={(itemId, quantity) => changeQuantity(selectedCampaign.id, itemId, quantity)}
                  />
                  {selectedCampaign.note ? <p className="flash-food-selected-note"><CalendarClock size={16} aria-hidden="true" /> {selectedCampaign.note}</p> : null}
                </>
              ) : <EmptyMenu />}
              </div>
              <CampaignRail campaigns={railCampaigns} selectedId={selectedCampaign?.id || ""} onSelect={setSelectedCampaignId} clock={clock} />
              {selectedCampaign ? <div className="flash-food-rail-order">
                <OrderBoard
                campaign={selectedCampaign}
                quantities={quantitiesByCampaign[selectedCampaign.id] || {}}
                pickupLocation={pickupLocationsByCampaign[selectedCampaign.id] || ""}
                note={notesByCampaign[selectedCampaign.id] || ""}
                saving={savingCampaignId === selectedCampaign.id}
                onQuantityChange={(itemId, quantity) => changeQuantity(selectedCampaign.id, itemId, quantity)}
                onPickupLocationChange={(location) => setPickupLocationsByCampaign((current) => ({ ...current, [selectedCampaign.id]: location }))}
                onNoteChange={(note) => setNotesByCampaign((current) => ({ ...current, [selectedCampaign.id]: note }))}
                onSubmit={() => submitCampaign(selectedCampaign)}
                />
              </div> : null}
            </div>
          </>
        ) : null}
      </section>
    </MemberLayout>
  );
}
