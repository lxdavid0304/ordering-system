export const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

const weekdayMap = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function getTaipeiParts() {
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

export function isWithinSchedule(schedule) {
  if (!schedule || schedule.is_always_open) {
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

export function formatSchedule(schedule) {
  if (!schedule) {
    return "尚未設定";
  }
  if (schedule.is_always_open) {
    return "永遠開放";
  }

  return `週${weekdayLabels[schedule.open_day]} ${pad2(schedule.open_hour)}:00 開放 / 週${
    weekdayLabels[schedule.close_day]
  } ${pad2(schedule.close_hour)}:59 關閉`;
}
