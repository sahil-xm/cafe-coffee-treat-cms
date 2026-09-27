const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("./db/init");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const TAX_RATE = 0.05;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const row = db
    .prepare(
      `SELECT s.id, s.name, s.username, s.password_hash, s.is_active, r.name AS role
       FROM staff s JOIN roles r ON r.id = s.role_id
       WHERE s.username = ?`
    )
    .get(username);

  if (!row || !row.is_active || !bcrypt.compareSync(password || "", row.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  res.json({ id: row.id, name: row.name, username: row.username, role: row.role });
});

app.get("/api/roles", (req, res) => {
  res.json(db.prepare("SELECT id, name FROM roles ORDER BY id").all());
});

// ---------------------------------------------------------------
// Menu
// ---------------------------------------------------------------
app.get("/api/menu", (req, res) => {
  const categories = db.prepare("SELECT id, name FROM categories ORDER BY id").all();
  const items = db
    .prepare("SELECT id, category_id, name, price, is_available FROM menu_items ORDER BY id")
    .all();
  res.json(
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: items
        .filter((i) => i.category_id === c.id)
        .map((i) => ({ id: i.id, name: i.name, price: i.price, isAvailable: !!i.is_available })),
    }))
  );
});

app.post("/api/menu-items", (req, res) => {
  const { categoryName, name, price } = req.body;
  if (!categoryName || !name || price == null) {
    return res.status(400).json({ error: "categoryName, name and price are required." });
  }
  let category = db.prepare("SELECT id FROM categories WHERE name = ?").get(categoryName);
  if (!category) {
    const info = db.prepare("INSERT INTO categories (name) VALUES (?)").run(categoryName);
    category = { id: info.lastInsertRowid };
  }
  const info = db
    .prepare("INSERT INTO menu_items (category_id, name, price) VALUES (?, ?, ?)")
    .run(category.id, name, price);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put("/api/menu-items/:id", (req, res) => {
  const { name, price } = req.body;
  db.prepare("UPDATE menu_items SET name = ?, price = ? WHERE id = ?").run(
    name,
    price,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/menu-items/:id", (req, res) => {
  db.prepare("DELETE FROM menu_items WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Tables
// ---------------------------------------------------------------
app.get("/api/tables", (req, res) => {
  res.json(db.prepare("SELECT id, table_number, status FROM dining_tables ORDER BY table_number").all());
});

// ---------------------------------------------------------------
// Orders (POS + KDS)
// ---------------------------------------------------------------
app.post("/api/orders", (req, res) => {
  const { tableId, staffId, paymentMethod, items } = req.body;
  if (!staffId || !paymentMethod || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "staffId, paymentMethod and items are required." });
  }

  const menuItemIds = items.map((i) => i.menuItemId);
  const placeholders = menuItemIds.map(() => "?").join(",");
  const menuRows = db
    .prepare(`SELECT id, name, price FROM menu_items WHERE id IN (${placeholders})`)
    .all(...menuItemIds);
  const menuById = Object.fromEntries(menuRows.map((m) => [m.id, m]));

  let subtotal = 0;
  const lines = items.map((i) => {
    const m = menuById[i.menuItemId];
    if (!m) throw new Error("Unknown menu item: " + i.menuItemId);
    const lineTotal = m.price * i.quantity;
    subtotal += lineTotal;
    return { name: m.name, price: m.price, qty: i.quantity, lineTotal };
  });
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  const status = paymentMethod === "Hold" ? "Held" : "Pending";

  const insertOrder = db.prepare(
    `INSERT INTO orders (table_id, staff_id, status, payment_method, subtotal, tax_amount, total_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, item_name_snapshot, unit_price_snapshot, quantity, line_total)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertLog = db.prepare(
    `INSERT INTO order_status_log (order_id, status, changed_by) VALUES (?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const info = insertOrder.run(tableId || null, staffId, status, paymentMethod, subtotal, tax, total);
    const orderId = info.lastInsertRowid;
    lines.forEach((l) =>
      insertItem.run(orderId, null, l.name, l.price, l.qty, l.lineTotal)
    );
    insertLog.run(orderId, status, staffId);
    if (tableId) {
      db.prepare("UPDATE dining_tables SET status = 'occupied' WHERE id = ?").run(tableId);
    }
    return orderId;
  });

  try {
    const orderId = tx();
    res.status(201).json({ id: orderId, status, subtotal, tax, total });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/orders/kds", (req, res) => {
  const orders = db
    .prepare(
      `SELECT id, table_id, status, created_at FROM orders
       WHERE status IN ('Pending','Preparing','Ready') ORDER BY created_at ASC`
    )
    .all();
  const items = db.prepare("SELECT order_id, item_name_snapshot, quantity FROM order_items").all();

  const grouped = { Pending: [], Preparing: [], Ready: [] };
  orders.forEach((o) => {
    grouped[o.status].push({
      id: o.id,
      table: o.table_id,
      createdAt: o.created_at,
      items: items
        .filter((i) => i.order_id === o.id)
        .map((i) => ({ n: i.item_name_snapshot, qty: i.quantity })),
    });
  });
  res.json(grouped);
});

const NEXT_STATUS = { Pending: "Preparing", Preparing: "Ready", Ready: "Served" };

app.patch("/api/orders/:id/advance", (req, res) => {
  const { staffId } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const next = NEXT_STATUS[order.status];
  if (!next) return res.status(400).json({ error: `Order is already ${order.status}.` });

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = ?, served_at = ? WHERE id = ?").run(
      next,
      next === "Served" ? now() : null,
      order.id
    );
    db.prepare("INSERT INTO order_status_log (order_id, status, changed_by) VALUES (?, ?, ?)").run(
      order.id,
      next,
      staffId || null
    );
    if (next === "Served" && order.table_id) {
      db.prepare("UPDATE dining_tables SET status = 'free' WHERE id = ?").run(order.table_id);
    }
  });
  tx();
  res.json({ id: order.id, status: next });
});

app.get("/api/orders", (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  const items = db.prepare("SELECT order_id, item_name_snapshot, quantity FROM order_items").all();
  res.json(
    orders.map((o) => ({
      id: o.id,
      table: o.table_id,
      status: o.status,
      method: o.payment_method,
      total: o.total_amount,
      items: items
        .filter((i) => i.order_id === o.id)
        .map((i) => ({ n: i.item_name_snapshot, qty: i.quantity })),
    }))
  );
});

// ---------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------
app.get("/api/inventory", (req, res) => {
  const rows = db.prepare("SELECT * FROM inventory_items ORDER BY name").all();
  res.json(
    rows.map((i) => ({
      id: i.id,
      n: i.name,
      qty: i.quantity,
      unit: i.unit,
      min: i.min_threshold,
      low: i.quantity < i.min_threshold,
    }))
  );
});

app.post("/api/inventory", (req, res) => {
  const { name, quantity, unit, minThreshold } = req.body;
  const info = db
    .prepare("INSERT INTO inventory_items (name, quantity, unit, min_threshold) VALUES (?, ?, ?, ?)")
    .run(name, quantity || 0, unit || "units", minThreshold || 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch("/api/inventory/:id/adjust", (req, res) => {
  const { delta, staffId, reason, note } = req.body;
  const item = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Inventory item not found." });
  const newQty = Math.max(0, item.quantity + delta);

  const tx = db.transaction(() => {
    db.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?").run(
      newQty,
      now(),
      item.id
    );
    db.prepare(
      `INSERT INTO inventory_transactions (inventory_item_id, staff_id, change_qty, reason, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run(item.id, staffId || null, delta, reason || "adjustment", note || null);
  });
  tx();
  res.json({ id: item.id, quantity: newQty });
});

// ---------------------------------------------------------------
// Staff
// ---------------------------------------------------------------
app.get("/api/staff", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.id, s.name, s.username, r.name AS role FROM staff s
         JOIN roles r ON r.id = s.role_id ORDER BY s.id`
      )
      .all()
  );
});

app.post("/api/staff", (req, res) => {
  const { name, username, password, roleName } = req.body;
  const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!role) return res.status(400).json({ error: "Unknown role: " + roleName });
  const hash = bcrypt.hashSync(password || "changeme", 10);
  const info = db
    .prepare("INSERT INTO staff (role_id, name, username, password_hash) VALUES (?, ?, ?, ?)")
    .run(role.id, name, username, hash);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put("/api/staff/:id", (req, res) => {
  const { name, username, roleName } = req.body;
  const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(roleName);
  if (!role) return res.status(400).json({ error: "Unknown role: " + roleName });
  db.prepare("UPDATE staff SET name = ?, username = ?, role_id = ? WHERE id = ?").run(
    name,
    username,
    role.id,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/staff/:id", (req, res) => {
  db.prepare("DELETE FROM staff WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Reports
// ---------------------------------------------------------------
app.get("/api/reports/summary", (req, res) => {
  const revenue =
    db.prepare("SELECT COALESCE(SUM(total_amount),0) AS v FROM orders WHERE status = 'Served'").get().v;
  const ordersCompleted = db
    .prepare("SELECT COUNT(*) AS v FROM orders WHERE status = 'Served'")
    .get().v;
  const best = db
    .prepare(
      `SELECT oi.item_name_snapshot AS name, SUM(oi.quantity) AS qty
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'Served'
       GROUP BY oi.item_name_snapshot ORDER BY qty DESC LIMIT 1`
    )
    .get();
  const tablesOccupied = db
    .prepare("SELECT COUNT(*) AS v FROM dining_tables WHERE status = 'occupied'")
    .get().v;

  res.json({
    revenue,
    ordersCompleted,
    bestSeller: best ? best.name : "—",
    tablesOccupied,
  });
});

// ---------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cafe Coffee Treat API running at http://localhost:${PORT}`));
