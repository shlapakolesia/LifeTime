ALTER TABLE "Task" DROP CONSTRAINT "valid_task_interval";
ALTER TABLE "Task" ADD CONSTRAINT "valid_task_interval" CHECK (("scheduledStart" IS NULL AND "scheduledEnd" IS NULL) OR ("scheduledStart" IS NOT NULL AND "scheduledEnd" IS NOT NULL AND "scheduledEnd" > "scheduledStart"));
ALTER TABLE "User" ADD CONSTRAINT "valid_role" CHECK ("accountRole" IN ('user','admin'));
ALTER TABLE "User" ADD CONSTRAINT "valid_premium_status" CHECK ("premiumStatus" IN ('free','pending','premium','rejected'));
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "valid_privacy" CHECK ("privacy" IN ('private','busy','shared'));
ALTER TABLE "PremiumRequest" ADD CONSTRAINT "valid_review_status" CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE "UserProfile" ADD CONSTRAINT "valid_sharing" CHECK (sharing IN ('none','busy','selected'));
