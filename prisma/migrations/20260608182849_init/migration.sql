/*
  Warnings:

  - You are about to drop the `invoice_embeddings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "invoice_embeddings" DROP CONSTRAINT "invoice_embeddings_invoice_id_fkey";

-- DropTable
DROP TABLE "invoice_embeddings";
