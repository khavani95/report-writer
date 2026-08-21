CREATE TABLE "holidays" (
	"jalali_date" text PRIMARY KEY NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"title" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
