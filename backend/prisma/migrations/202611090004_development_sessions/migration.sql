CREATE TABLE "DevelopmentSession" (
 "id" UUID NOT NULL,
 "tokenHash" TEXT NOT NULL,
 "userId" UUID NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DevelopmentSession_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "DevelopmentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DevelopmentSession_tokenHash_key" ON "DevelopmentSession"("tokenHash");
CREATE INDEX "DevelopmentSession_userId_idx" ON "DevelopmentSession"("userId");
