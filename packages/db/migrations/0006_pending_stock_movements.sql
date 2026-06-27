CREATE TABLE "pending_stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"movement_type" varchar(20) NOT NULL,
	"input_qty" numeric(18, 6) NOT NULL,
	"input_unit_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"finalized_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_stock_movements_type_check" CHECK ("pending_stock_movements"."movement_type" IN ('opname', 'waste')),
	CONSTRAINT "pending_stock_movements_status_check" CHECK ("pending_stock_movements"."status" IN ('pending', 'validated', 'finalized', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_input_unit_id_units_id_fk" FOREIGN KEY ("input_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_stock_movements" ADD CONSTRAINT "pending_stock_movements_finalized_movement_id_stock_movements_id_fk" FOREIGN KEY ("finalized_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_stock_movements_company_idx" ON "pending_stock_movements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "pending_stock_movements_status_idx" ON "pending_stock_movements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_stock_movements_item_outlet_idx" ON "pending_stock_movements" USING btree ("item_id","outlet_id");--> statement-breakpoint
CREATE INDEX "pending_stock_movements_type_idx" ON "pending_stock_movements" USING btree ("movement_type");