-- Cafe Coffee Treat — SQLite schema (same design as the Postgres version,
-- adapted for zero-config local/dev use with better-sqlite3)

CREATE TABLE roles (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE
);

CREATE TABLE categories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE
);

CREATE TABLE staff (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id         INTEGER NOT NULL REFERENCES roles(id),
    name            TEXT NOT NULL,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE menu_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id     INTEGER NOT NULL REFERENCES categories(id),
    name            TEXT NOT NULL,
    price           REAL NOT NULL CHECK (price >= 0),
    is_available    INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (category_id, name)
);

CREATE TABLE dining_tables (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number    INTEGER NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied'))
);

CREATE TABLE orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id        INTEGER REFERENCES dining_tables(id),
    staff_id        INTEGER NOT NULL REFERENCES staff(id),
    status          TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Held','Pending','Preparing','Ready','Served')),
    payment_method  TEXT NOT NULL CHECK (payment_method IN ('Hold','Cash','Card')),
    subtotal        REAL NOT NULL CHECK (subtotal >= 0),
    tax_amount      REAL NOT NULL CHECK (tax_amount >= 0),
    total_amount    REAL NOT NULL CHECK (total_amount >= 0),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    served_at       TEXT
);

CREATE TABLE order_items (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id                INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id            INTEGER REFERENCES menu_items(id),
    item_name_snapshot      TEXT NOT NULL,
    unit_price_snapshot     REAL NOT NULL,
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    line_total              REAL NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE order_status_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    changed_by      INTEGER REFERENCES staff(id),
    changed_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    quantity        REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit            TEXT NOT NULL,
    min_threshold   REAL NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_transactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id   INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    staff_id            INTEGER REFERENCES staff(id),
    change_qty          REAL NOT NULL,
    reason              TEXT NOT NULL CHECK (reason IN ('restock','adjustment','consumption')),
    note                TEXT,
    created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipe_ingredients (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id        INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    inventory_item_id   INTEGER NOT NULL REFERENCES inventory_items(id),
    quantity_used       REAL NOT NULL CHECK (quantity_used > 0),
    UNIQUE (menu_item_id, inventory_item_id)
);
