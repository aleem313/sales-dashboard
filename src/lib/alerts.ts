import { getCachedStats, insertAlert } from "./data";
import { getKPIMetrics, getSystemHealth } from "./data";
import type { AlertThresholds } from "./types";

const DEFAULT_THRESHOLDS: AlertThresholds = {
  winRateMin: 20,
  responseTimeMaxHours: 4,
  dailyJobsMin: 5,
};

export async function checkAlerts(): Promise<
  { alert_type: string; message: string; current_value: number; threshold_value: number }[]
> {
  const cached = await getCachedStats("alert_thresholds");
  const thresholds: AlertThresholds = cached
    ? (cached as AlertThresholds)
    : DEFAULT_THRESHOLDS;

  const [kpi, health] = await Promise.all([getKPIMetrics(), getSystemHealth()]);

  const triggered: {
    alert_type: string;
    message: string;
    current_value: number;
    threshold_value: number;
  }[] = [];

  // Win rate too low
  if (kpi.winRate > 0 && kpi.winRate < thresholds.winRateMin) {
    triggered.push({
      alert_type: "win_rate_low",
      message: `Win rate is ${kpi.winRate}%, below threshold of ${thresholds.winRateMin}%`,
      current_value: kpi.winRate,
      threshold_value: thresholds.winRateMin,
    });
  }

  // GPT failure rate high (>20%)
  if (health.gptFailureRate > 20) {
    triggered.push({
      alert_type: "gpt_failure_high",
      message: `GPT failure rate is ${health.gptFailureRate}%, above 20% threshold`,
      current_value: health.gptFailureRate,
      threshold_value: 20,
    });
  }

  return triggered;
}

export async function dispatchAlerts(
  alerts: { alert_type: string; message: string; current_value: number; threshold_value: number }[]
): Promise<void> {
  for (const alert of alerts) {
    await insertAlert(alert);
    await sendSlackAlert(alert);
  }
}

async function sendSlackAlert(alert: {
  alert_type: string;
  message: string;
}): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[Alert] ${alert.alert_type}: ${alert.message} (Slack not configured)`);
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*Rising Lions Alert* — \`${alert.alert_type}\`\n${alert.message}`,
      }),
    });
  } catch (err) {
    console.error("Failed to send Slack alert:", err);
  }
}
