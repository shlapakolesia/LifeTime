CREATE TABLE "UserIdentity" (
 "subject" TEXT NOT NULL,
 "userId" UUID NOT NULL,
 "provider" TEXT NOT NULL DEFAULT 'cognito',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("subject"),
 CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");
