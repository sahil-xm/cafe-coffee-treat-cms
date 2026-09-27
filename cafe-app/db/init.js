const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "cafe.db");
const isNewDb = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

if (isNewDb) {
  console.log("No existing database found — creating schema and seed data...");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  seed();
  console.log("Database created at", DB_PATH);
}

function seed() {
  const insertRole = db.prepare("INSERT INTO roles (name) VALUES (?)");
  const roleTx = db.transaction((names) => names.forEach((n) => insertRole.run(n)));
  roleTx(["Administrator", "Cashier", "Kitchen", "Waiter"]);

  const roleId = (name) => db.prepare("SELECT id FROM roles WHERE name = ?").get(name).id;

  const insertStaff = db.prepare(
    `INSERT INTO staff (role_id, name, username, password_hash) VALUES (?, ?, ?, ?)`
  );
  const staffTx = db.transaction((rows) => {
    rows.forEach((r) => {
      const hash = bcrypt.hashSync(r.password, 10);
      insertStaff.run(roleId(r.role), r.name, r.username, hash);
    });
  });
  staffTx([
    { role: "Administrator", name: "Admin", username: "admin", password: "admin123" },
    { role: "Cashier", name: "Alice Sharma", username: "alice", password: "password123" },
    { role: "Kitchen", name: "Rahul Verma", username: "rahul", password: "password123" },
    { role: "Waiter", name: "Priya Nair", username: "priya", password: "password123" },
  ]);

  const insertCategory = db.prepare("INSERT INTO categories (name) VALUES (?)");
  const catTx = db.transaction((names) => names.forEach((n) => insertCategory.run(n)));
  catTx(["Beverages", "Bakery", "Desserts"]);

  const catId = (name) => db.prepare("SELECT id FROM categories WHERE name = ?").get(name).id;

  const insertMenuItem = db.prepare(
    "INSERT INTO menu_items (category_id, name, price) VALUES (?, ?, ?)"
  );
  const menuTx = db.transaction((rows) => {
    rows.forEach((r) => insertMenuItem.run(catId(r.cat), r.name, r.price));
  });
  menuTx([
    { cat: "Beverages", name: "Cappuccino", price: 180 },
    { cat: "Beverages", name: "Cold Brew", price: 210 },
    { cat: "Beverages", name: "Masala Chai", price: 90 },
    { cat: "Beverages", name: "Filter Coffee", price: 100 },
    { cat: "Beverages", name: "Iced Latte", price: 220 },
    { cat: "Bakery", name: "Butter Croissant", price: 140 },
    { cat: "Bakery", name: "Banana Bread", price: 120 },
    { cat: "Bakery", name: "Cheese Toastie", price: 160 },
    { cat: "Desserts", name: "Chocolate Brownie", price: 150 },
    { cat: "Desserts", name: "Tiramisu Cup", price: 190 },
    { cat: "Desserts", name: "Blueberry Muffin", price: 130 },
  ]);

  const insertTable = db.prepare("INSERT INTO dining_tables (table_number) VALUES (?)");
  const tableTx = db.transaction(() => {
    for (let i = 1; i <= 8; i++) insertTable.run(i);
  });
  tableTx();

  const insertInv = db.prepare(
    "INSERT INTO inventory_items (name, quantity, unit, min_threshold) VALUES (?, ?, ?, ?)"
  );
  const invTx = db.transaction((rows) => rows.forEach((r) => insertInv.run(r.name, r.qty, r.unit, r.min)));
  invTx([
    { name: "Coffee Beans", qty: 4.2, unit: "kg", min: 2 },
    { name: "Whole Milk", qty: 9, unit: "l", min: 6 },
    { name: "Sugar", qty: 1.1, unit: "kg", min: 2 },
    { name: "Butter", qty: 0.6, unit: "kg", min: 1 },
    { name: "Flour", qty: 5, unit: "kg", min: 3 },
    { name: "Cocoa Powder", qty: 0.4, unit: "kg", min: 0.5 },
  ]);
}

module.exports = db;
