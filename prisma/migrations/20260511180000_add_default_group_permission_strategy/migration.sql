-- AlterTable
ALTER TABLE "Dataroom" ADD COLUMN     "defaultGroupPermissionStrategy" "DefaultPermissionStrategy" NOT NULL DEFAULT 'INHERIT_FROM_PARENT';