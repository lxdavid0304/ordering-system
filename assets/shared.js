(function () {
  const config = window.APP_CONFIG || {};
  const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
  const configOk = required.every((key) => config[key] && config[key].length > 0);

  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  function getTaipeiParts() {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(new Date());
    const lookup = {};
    for (const part of parts) {
      lookup[part.type] = part.value;
    }
    return {
      weekday: weekdayMap[lookup.weekday],
      hour: Number(lookup.hour),
      minute: Number(lookup.minute),
    };
  }

  function toWeekMinute(day, hour, minute) {
    return day * 1440 + hour * 60 + minute;
  }

  function isWithinSchedule(schedule) {
    if (!schedule) {
      return true;
    }
    if (schedule.is_always_open) {
      return true;
    }
    const now = getTaipeiParts();
    const openMinute = toWeekMinute(schedule.open_day, schedule.open_hour, 0);
    const closeMinute = toWeekMinute(schedule.close_day, schedule.close_hour, 59);
    const nowMinute = toWeekMinute(now.weekday, now.hour, now.minute);

    if (openMinute <= closeMinute) {
      return nowMinute >= openMinute && nowMinute <= closeMinute;
    }
    return nowMinute >= openMinute || nowMinute <= closeMinute;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatSchedule(schedule) {
    if (!schedule) {
      return "尚未設定";
    }
    if (schedule.is_always_open) {
      return "永遠開放";
    }
    const openLabel = `週${weekdayLabels[schedule.open_day]}`;
    const closeLabel = `週${weekdayLabels[schedule.close_day]}`;
    const openTime = `${pad2(schedule.open_hour)}:00`;
    const closeTime = `${pad2(schedule.close_hour)}:59`;
    return `${openLabel} ${openTime} 開放 / ${closeLabel} ${closeTime} 關閉`;
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("zh-TW");
  }

  function getSupabaseClient() {
    if (!configOk || !window.supabase) {
      return null;
    }
    return window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }

  window.App = {
    config,
    configOk,
    weekdayLabels,
    getTaipeiParts,
    isWithinSchedule,
    formatSchedule,
    formatCurrency,
    getSupabaseClient,
  };
})();
