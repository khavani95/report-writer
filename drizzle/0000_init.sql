CREATE TABLE "activity_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_day_id" integer NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"place" text,
	"description" text DEFAULT '' NOT NULL,
	"start_time" text,
	"end_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"chat_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"phase" text DEFAULT 'idle' NOT NULL,
	"pending_text" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"jalali_date" text PRIMARY KEY NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"title" text,
	"source" text DEFAULT 'legacy' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"jalali_date" text NOT NULL,
	"date_label" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"user_id" bigint,
	"full_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role" text,
	"profile_status" text DEFAULT 'pending' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_day_id" integer NOT NULL,
	"sender_user_id" bigint,
	"telegram_message_id" bigint,
	"kind" text NOT NULL,
	"text" text,
	"transcript" text,
	"telegram_file_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_member_day_id_member_days_id_fk" FOREIGN KEY ("member_day_id") REFERENCES "public"."member_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_days" ADD CONSTRAINT "member_days_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_messages" ADD CONSTRAINT "raw_messages_member_day_id_member_days_id_fk" FOREIGN KEY ("member_day_id") REFERENCES "public"."member_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_day_idx" ON "activity_segments" USING btree ("member_day_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_state_pk" ON "conversation_state" USING btree ("chat_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_days_member_date_idx" ON "member_days" USING btree ("member_id","jalali_date");--> statement-breakpoint
CREATE INDEX "member_days_status_idx" ON "member_days" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "members_chat_idx" ON "members" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_chat_user_idx" ON "members" USING btree ("chat_id","user_id");--> statement-breakpoint
CREATE INDEX "raw_messages_day_idx" ON "raw_messages" USING btree ("member_day_id");