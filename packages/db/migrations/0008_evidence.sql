CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_id" uuid,
	"record_type" varchar(40) NOT NULL,
	"record_id" uuid NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "evidence_record_type_check" CHECK ("evidence"."record_type" IN ('daily_report')),
	CONSTRAINT "evidence_content_type_check" CHECK ("evidence"."content_type" IN ('image/jpeg', 'image/png', 'application/pdf')),
	CONSTRAINT "evidence_status_check" CHECK ("evidence"."status" IN ('pending', 'confirmed'))
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_record_idx" ON "evidence" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "evidence_company_idx" ON "evidence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_outlet_idx" ON "evidence" USING btree ("outlet_id");