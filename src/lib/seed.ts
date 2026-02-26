import { sql } from "@vercel/postgres";

const categories = [
  "Electronics",
  "Clothing",
  "Home & Garden",
  "Sports",
  "Books",
  "Food & Beverage",
];

const products: { name: string; categoryIndex: number; price: number }[] = [
  // Electronics
  { name: "Wireless Headphones", categoryIndex: 0, price: 79.99 },
  { name: "Smart Watch", categoryIndex: 0, price: 249.99 },
  { name: "Bluetooth Speaker", categoryIndex: 0, price: 49.99 },
  { name: "USB-C Hub", categoryIndex: 0, price: 34.99 },
  // Clothing
  { name: "Denim Jacket", categoryIndex: 1, price: 89.99 },
  { name: "Running Shoes", categoryIndex: 1, price: 129.99 },
  { name: "Cotton T-Shirt Pack", categoryIndex: 1, price: 29.99 },
  { name: "Winter Parka", categoryIndex: 1, price: 199.99 },
  // Home & Garden
  { name: "Robot Vacuum", categoryIndex: 2, price: 299.99 },
  { name: "Indoor Plant Set", categoryIndex: 2, price: 44.99 },
  { name: "Scented Candle Collection", categoryIndex: 2, price: 24.99 },
  { name: "Throw Blanket", categoryIndex: 2, price: 39.99 },
  // Sports
  { name: "Yoga Mat Premium", categoryIndex: 3, price: 59.99 },
  { name: "Resistance Bands Set", categoryIndex: 3, price: 19.99 },
  { name: "Water Bottle Insulated", categoryIndex: 3, price: 29.99 },
  { name: "Fitness Tracker", categoryIndex: 3, price: 149.99 },
  // Books
  { name: "Bestseller Fiction Novel", categoryIndex: 4, price: 14.99 },
  { name: "Cookbook Collection", categoryIndex: 4, price: 34.99 },
  { name: "Business Strategy Guide", categoryIndex: 4, price: 24.99 },
  { name: "Science Encyclopedia", categoryIndex: 4, price: 49.99 },
  // Food & Beverage
  { name: "Artisan Coffee Beans", categoryIndex: 5, price: 18.99 },
  { name: "Organic Tea Sampler", categoryIndex: 5, price: 22.99 },
  { name: "Dark Chocolate Box", categoryIndex: 5, price: 15.99 },
  { name: "Gourmet Spice Set", categoryIndex: 5, price: 27.99 },
];

const regions = [
  "North America",
  "Europe",
  "Asia Pacific",
  "Latin America",
  "Middle East",
  "Africa",
  "Oceania",
  "Central Asia",
];

const firstNames = [
  "James", "Emma", "Liam", "Olivia", "Noah", "Ava", "William", "Sophia",
  "Benjamin", "Isabella", "Lucas", "Mia", "Henry", "Charlotte", "Alexander",
  "Amelia", "Daniel", "Harper", "Matthew", "Evelyn", "Sebastian", "Aria",
  "Jack", "Luna", "Owen", "Chloe", "Theodore", "Penelope", "Aiden", "Layla",
  "Samuel", "Riley", "Ryan", "Zoey", "Nathan", "Nora", "Caleb", "Lily",
  "Christian", "Eleanor", "Dylan", "Hannah", "Isaac", "Lillian", "Ethan", "Addison",
  "Leo", "Aubrey", "Adrian", "Ellie",
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
  "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill",
  "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell",
  "Mitchell", "Carter", "Roberts", "Gomez",
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export async function seed() {
  const random = seededRandom(42);

  // Drop tables in reverse order
  await sql`DROP TABLE IF EXISTS sales CASCADE`;
  await sql`DROP TABLE IF EXISTS customers CASCADE`;
  await sql`DROP TABLE IF EXISTS products CASCADE`;
  await sql`DROP TABLE IF EXISTS regions CASCADE`;
  await sql`DROP TABLE IF EXISTS categories CASCADE`;

  // Create tables
  await sql`
    CREATE TABLE categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      price DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE regions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(200) NOT NULL,
      region_id INTEGER REFERENCES regions(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE sales (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      total_amount DECIMAL(10, 2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  // Indexes
  await sql`CREATE INDEX idx_sales_created_at ON sales(created_at)`;
  await sql`CREATE INDEX idx_sales_status ON sales(status)`;
  await sql`CREATE INDEX idx_sales_product_id ON sales(product_id)`;
  await sql`CREATE INDEX idx_sales_customer_id ON sales(customer_id)`;
  await sql`CREATE INDEX idx_customers_region_id ON customers(region_id)`;
  await sql`CREATE INDEX idx_products_category_id ON products(category_id)`;

  // Insert categories
  for (const name of categories) {
    await sql`INSERT INTO categories (name) VALUES (${name})`;
  }

  // Insert products
  for (const product of products) {
    await sql`
      INSERT INTO products (name, category_id, price)
      VALUES (${product.name}, ${product.categoryIndex + 1}, ${product.price})
    `;
  }

  // Insert regions
  for (const name of regions) {
    await sql`INSERT INTO regions (name) VALUES (${name})`;
  }

  // Insert 200 customers
  for (let i = 0; i < 200; i++) {
    const firstName = firstNames[Math.floor(random() * firstNames.length)];
    const lastName = lastNames[Math.floor(random() * lastNames.length)];
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
    const regionId = Math.floor(random() * regions.length) + 1;
    await sql`
      INSERT INTO customers (name, email, region_id)
      VALUES (${name}, ${email}, ${regionId})
    `;
  }

  // Insert 2000 sales spanning 12 months
  const now = new Date();
  const statuses = ["completed", "completed", "completed", "completed", "pending", "cancelled"];

  for (let i = 0; i < 2000; i++) {
    const customerId = Math.floor(random() * 200) + 1;
    const productId = Math.floor(random() * 24) + 1;
    const product = products[productId - 1];
    const quantity = Math.floor(random() * 4) + 1;
    const totalAmount = +(product.price * quantity * (0.85 + random() * 0.3)).toFixed(2);
    const status = statuses[Math.floor(random() * statuses.length)];

    // Random date within the last 12 months
    const daysAgo = Math.floor(random() * 365);
    const saleDate = new Date(now);
    saleDate.setDate(saleDate.getDate() - daysAgo);
    saleDate.setHours(
      Math.floor(random() * 24),
      Math.floor(random() * 60),
      Math.floor(random() * 60)
    );

    await sql`
      INSERT INTO sales (customer_id, product_id, quantity, total_amount, status, created_at)
      VALUES (${customerId}, ${productId}, ${quantity}, ${totalAmount}, ${status}, ${saleDate.toISOString()})
    `;
  }

  return {
    categories: categories.length,
    products: products.length,
    regions: regions.length,
    customers: 200,
    sales: 2000,
  };
}
