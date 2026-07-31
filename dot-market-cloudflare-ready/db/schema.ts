import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const priceSettings = sqliteTable("price_settings", {
  id: integer("id").primaryKey(),
  tilePrice: integer("tile_price").notNull().default(2000),
  day1Multiplier: integer("day_1_multiplier").notNull().default(1550),
  day2Multiplier: integer("day_2_multiplier").notNull().default(1400),
  day3Multiplier: integer("day_3_multiplier").notNull().default(1300),
  day4Multiplier: integer("day_4_multiplier").notNull().default(1200),
  day5Multiplier: integer("day_5_multiplier").notNull().default(1120),
  day6Multiplier: integer("day_6_multiplier").notNull().default(1060),
  day7Multiplier: integer("day_7_multiplier").notNull().default(1000),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shops = sqliteTable("shops", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  aboutTitle: text("about_title").notNull().default("작업 안내"),
  aboutText: text("about_text").notNull().default(""),
  managerEmail: text("manager_email").notNull(),
  webhookCiphertext: text("webhook_ciphertext"),
  webhookIv: text("webhook_iv"),
  tilePrice: integer("tile_price").notNull().default(2000),
  day1Multiplier: integer("day_1_multiplier").notNull().default(1550),
  day2Multiplier: integer("day_2_multiplier").notNull().default(1400),
  day3Multiplier: integer("day_3_multiplier").notNull().default(1300),
  day4Multiplier: integer("day_4_multiplier").notNull().default(1200),
  day5Multiplier: integer("day_5_multiplier").notNull().default(1120),
  day6Multiplier: integer("day_6_multiplier").notNull().default(1060),
  day7Multiplier: integer("day_7_multiplier").notNull().default(1000),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopImages = sqliteTable("shop_images", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  contact: text("contact").notNull(),
  note: text("note").notNull().default(""),
  gridX: integer("grid_x").notNull(),
  gridY: integer("grid_y").notNull(),
  tileCount: integer("tile_count").notNull(),
  deadline: integer("deadline").notNull(),
  totalPrice: integer("total_price").notNull(),
  cropLabel: text("crop_label").notNull(),
  originalFilename: text("original_filename").notNull(),
  previewObjectKey: text("preview_object_key").notNull().unique(),
  previewContentType: text("preview_content_type").notNull().default("image/png"),
  originalObjectKey: text("original_object_key"),
  originalContentType: text("original_content_type"),
  status: text("status").notNull().default("new"),
  webhookSent: integer("webhook_sent", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
