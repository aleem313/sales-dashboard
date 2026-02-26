export interface KPIMetrics {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  conversionRate: number;
}

export interface RevenueOverTime {
  date: string;
  revenue: number;
  orders: number;
}

export interface SalesByCategory {
  category: string;
  revenue: number;
  orders: number;
}

export interface SalesByRegion {
  region: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  name: string;
  category: string;
  revenue: number;
  unitsSold: number;
}

export interface RecentSale {
  id: number;
  customerName: string;
  customerEmail: string;
  product: string;
  amount: number;
  status: string;
  date: string;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}
