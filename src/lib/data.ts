import { sql } from "@vercel/postgres";
import type {
  KPIMetrics,
  RevenueOverTime,
  SalesByCategory,
  SalesByRegion,
  TopProduct,
  RecentSale,
  DateRange,
} from "./types";

export async function getKPIMetrics(
  range?: DateRange
): Promise<KPIMetrics> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      COALESCE(SUM(total_amount), 0) AS total_revenue,
      COUNT(*) AS total_orders,
      COALESCE(AVG(total_amount), 0) AS avg_order_value,
      COALESCE(
        ROUND(
          COUNT(CASE WHEN status = 'completed' THEN 1 END)::DECIMAL / NULLIF(COUNT(*), 0) * 100,
          1
        ),
        0
      ) AS conversion_rate
    FROM sales
    WHERE status != 'cancelled'
      AND (${startDate}::timestamp IS NULL OR created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR created_at <= ${endDate}::timestamp)
  `;

  const row = result.rows[0];
  return {
    totalRevenue: parseFloat(row.total_revenue),
    totalOrders: parseInt(row.total_orders),
    avgOrderValue: parseFloat(row.avg_order_value),
    conversionRate: parseFloat(row.conversion_rate),
  };
}

export async function getRevenueOverTime(
  range?: DateRange
): Promise<RevenueOverTime[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
      SUM(total_amount) AS revenue,
      COUNT(*) AS orders
    FROM sales
    WHERE status != 'cancelled'
      AND (${startDate}::timestamp IS NULL OR created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR created_at <= ${endDate}::timestamp)
    GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
    ORDER BY date
  `;

  return result.rows.map((row) => ({
    date: row.date,
    revenue: parseFloat(row.revenue),
    orders: parseInt(row.orders),
  }));
}

export async function getSalesByCategory(
  range?: DateRange
): Promise<SalesByCategory[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      c.name AS category,
      SUM(s.total_amount) AS revenue,
      COUNT(s.id) AS orders
    FROM sales s
    JOIN products p ON s.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    WHERE s.status != 'cancelled'
      AND (${startDate}::timestamp IS NULL OR s.created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR s.created_at <= ${endDate}::timestamp)
    GROUP BY c.name
    ORDER BY revenue DESC
  `;

  return result.rows.map((row) => ({
    category: row.category,
    revenue: parseFloat(row.revenue),
    orders: parseInt(row.orders),
  }));
}

export async function getSalesByRegion(
  range?: DateRange
): Promise<SalesByRegion[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      r.name AS region,
      SUM(s.total_amount) AS revenue,
      COUNT(s.id) AS orders
    FROM sales s
    JOIN customers cu ON s.customer_id = cu.id
    JOIN regions r ON cu.region_id = r.id
    WHERE s.status != 'cancelled'
      AND (${startDate}::timestamp IS NULL OR s.created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR s.created_at <= ${endDate}::timestamp)
    GROUP BY r.name
    ORDER BY revenue DESC
  `;

  return result.rows.map((row) => ({
    region: row.region,
    revenue: parseFloat(row.revenue),
    orders: parseInt(row.orders),
  }));
}

export async function getTopProducts(
  range?: DateRange
): Promise<TopProduct[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      p.name,
      c.name AS category,
      SUM(s.total_amount) AS revenue,
      SUM(s.quantity) AS units_sold
    FROM sales s
    JOIN products p ON s.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    WHERE s.status != 'cancelled'
      AND (${startDate}::timestamp IS NULL OR s.created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR s.created_at <= ${endDate}::timestamp)
    GROUP BY p.name, c.name
    ORDER BY revenue DESC
    LIMIT 5
  `;

  return result.rows.map((row) => ({
    name: row.name,
    category: row.category,
    revenue: parseFloat(row.revenue),
    unitsSold: parseInt(row.units_sold),
  }));
}

export async function getRecentSales(
  range?: DateRange
): Promise<RecentSale[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      s.id,
      cu.name AS customer_name,
      cu.email AS customer_email,
      p.name AS product,
      s.total_amount AS amount,
      s.status,
      TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date
    FROM sales s
    JOIN customers cu ON s.customer_id = cu.id
    JOIN products p ON s.product_id = p.id
    WHERE (${startDate}::timestamp IS NULL OR s.created_at >= ${startDate}::timestamp)
      AND (${endDate}::timestamp IS NULL OR s.created_at <= ${endDate}::timestamp)
    ORDER BY s.created_at DESC
    LIMIT 10
  `;

  return result.rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    product: row.product,
    amount: parseFloat(row.amount),
    status: row.status,
    date: row.date,
  }));
}
