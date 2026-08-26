CREATE TABLE "processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
