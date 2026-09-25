-- CreateTable
CREATE TABLE "_GaStaffCompanies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GaStaffCompanies_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_GaStaffCompanies_B_index" ON "_GaStaffCompanies"("B");

-- AddForeignKey
ALTER TABLE "_GaStaffCompanies" ADD CONSTRAINT "_GaStaffCompanies_A_fkey" FOREIGN KEY ("A") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GaStaffCompanies" ADD CONSTRAINT "_GaStaffCompanies_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
