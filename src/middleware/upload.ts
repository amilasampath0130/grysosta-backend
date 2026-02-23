import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

export const uploadAdvertisementImage = upload.single("image");

export const uploadVendorDocuments = upload.fields([
  { name: "userIdImage", maxCount: 1 },
  { name: "businessRegImage", maxCount: 1 },
]);
