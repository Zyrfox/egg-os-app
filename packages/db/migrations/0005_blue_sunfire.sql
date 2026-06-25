CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_outlet_id" uuid NOT NULL,
	"to_outlet_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"input_qty" numeric(18, 6) NOT NULL,
	"input_unit_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ref_no" text,
	"reason" text,
	"sent_by" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_status_check" CHECK ("stock_transfers"."status" IN ('pending', 'received')),
	CONSTRAINT "stock_transfers_different_outlets_check" CHECK ("stock_transfers"."from_outlet_id" <> "stock_transfers"."to_outlet_id")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_type_check";--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_outlet_id_outlets_id_fk" FOREIGN KEY ("from_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_outlet_id_outlets_id_fk" FOREIGN KEY ("to_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_input_unit_id_units_id_fk" FOREIGN KEY ("input_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_transfers_company_idx" ON "stock_transfers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stock_transfers_from_outlet_idx" ON "stock_transfers" USING btree ("from_outlet_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_to_outlet_idx" ON "stock_transfers" USING btree ("to_outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outlets_company_in_transit_uq" ON "outlets" USING btree ("company_id") WHERE "outlets"."outlet_type" = 'in_transit' AND "outlets"."deleted_at" IS NULL;--> statement-breakpoint
INSERT INTO "outlets" (
	"company_id",
	"brand_id",
	"outlet_code",
	"outlet_name",
	"outlet_type",
	"timezone",
	"status",
	"is_active",
	"metadata"
)
SELECT
	c."id",
	b."id",
	'IN_TRANSIT',
	'System In-Transit',
	'in_transit',
	'Asia/Jakarta',
	'active',
	true,
	'{"system":true,"virtual":"in_transit"}'::jsonb
FROM "companies" c
JOIN LATERAL (
	SELECT "id"
	FROM "brands"
	WHERE "company_id" = c."id"
	  AND "deleted_at" IS NULL
	ORDER BY "created_at", "id"
	LIMIT 1
) b ON true
WHERE c."deleted_at" IS NULL
  AND NOT EXISTS (
	SELECT 1
	FROM "outlets" o
	WHERE o."company_id" = c."id"
	  AND o."outlet_type" = 'in_transit'
	  AND o."deleted_at" IS NULL
  )
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("stock_movements"."movement_type" IN ('stock_in', 'stock_out', 'opname', 'waste', 'transfer_in', 'transfer_out'));
