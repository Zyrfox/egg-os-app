CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"report_type" varchar(20) NOT NULL,
	"report_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "daily_reports_status_check" CHECK ("daily_reports"."status" IN ('draft', 'submitted', 'validated', 'rejected')),
	CONSTRAINT "daily_reports_type_check" CHECK ("daily_reports"."report_type" IN ('opening', 'closing', 'issue'))
);
--> statement-breakpoint
CREATE TABLE "report_checklist_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"value" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_id" uuid,
	"report_type" varchar(20) NOT NULL,
	"label" varchar(200) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "report_checklist_items_type_check" CHECK ("report_checklist_items"."report_type" IN ('opening', 'closing', 'issue'))
);
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_checklist_answers" ADD CONSTRAINT "report_checklist_answers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_checklist_answers" ADD CONSTRAINT "report_checklist_answers_report_id_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_checklist_answers" ADD CONSTRAINT "report_checklist_answers_checklist_item_id_report_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."report_checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_checklist_items" ADD CONSTRAINT "report_checklist_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_checklist_items" ADD CONSTRAINT "report_checklist_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_outlet_type_date_uq" ON "daily_reports" USING btree ("outlet_id","report_type","report_date") WHERE "daily_reports"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "daily_reports_outlet_idx" ON "daily_reports" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "daily_reports_status_idx" ON "daily_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "daily_reports_date_idx" ON "daily_reports" USING btree ("report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "report_checklist_answers_uq" ON "report_checklist_answers" USING btree ("report_id","checklist_item_id");--> statement-breakpoint
CREATE INDEX "report_checklist_answers_report_idx" ON "report_checklist_answers" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_checklist_items_company_idx" ON "report_checklist_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "report_checklist_items_lookup_idx" ON "report_checklist_items" USING btree ("company_id","report_type","outlet_id");