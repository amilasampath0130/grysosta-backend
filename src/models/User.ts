import mongoose, { Types } from "mongoose";
import bcrypt from "bcryptjs";

/* =======================
   Interfaces
======================= */

export interface IUser {
  _id: Types.ObjectId;

  // Basic user info
  name: string;
  username: string;
  email: string;
  password?: string;
  // Vendor dashboard password (separate from main app login)
  vendorDashboardPassword?: string;
  mobileNumber?: string;
  profileImage?: string;

  // Auth & role
  role: "user" | "admin" | "vendor";
  authProvider: "local" | "google";
  isVerified: boolean;

  // Admin OTP (admin login flow)
  adminOtp?: string;
  adminOtpExpires?: Date;
  adminOtpSentAt?: Date;

  // Email OTP (registration verification)
  emailOtp?: string;
  emailOtpExpires?: Date;
  emailOtpSentAt?: Date;

  // Vendor onboarding flow
  vendorStatus?: "NEW" | "PENDING" | "APPROVED" | "REJECTED";
  vendorInfo?: {
    businessName: string;
    ownerName: string;
    phone: string;
    address: string;
    logoUrl?: string;
    logoPublicId?: string;
  };

  vendorApplication?: {
    personal?: {
      firstName?: string;
      middleName?: string;
      lastName?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      email?: string;
      phoneNumber?: string;
      vendorRole?: string;
      referralSalesId?: string;
      termsAccepted?: boolean;
    };
    business?: {
      businessName?: string;
      businessType?: string;
      businessCategory?: string;
      businessAddress?: string;
      businessPhoneNumber?: string;
      typeofoffering?: string;
      website?: string;
      yearEstablished?: string;
      taxId?: string;
    };
    documents?: {
      userIdImageUrl?: string;
      userIdImagePublicId?: string;
      businessRegImageUrl?: string;
      businessRegImagePublicId?: string;
      logoUrl?: string;
      logoPublicId?: string;
    };
    pdfUrl?: string;
    pdfPublicId?: string;
    submittedAt?: Date;
  };
  vendorApproval?: {
    approvedAt?: Date;
    approvedBy?: Types.ObjectId;
  };
  vendorRejectionReason?: string;

  // Vendor billing / subscription
  vendorSubscription?: {
    planKey?: "bronze" | "silver" | "gold";
    status?: string;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
  };

  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  compareVendorDashboardPassword(candidatePassword: string): Promise<boolean>;
}

/* =======================
   Sub Schemas
======================= */

// Vendor information (submitted by vendor)
const vendorInfoSchema = new mongoose.Schema(
  {
    businessName: { type: String },
    ownerName: { type: String },
    phone: { type: String },
    address: { type: String },
    logoUrl: { type: String },
    logoPublicId: { type: String },
  },
  { _id: false },
);

// Vendor approval metadata (admin side)
const vendorApprovalSchema = new mongoose.Schema(
  {
    approvedAt: { type: Date },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { _id: false },
);

const vendorApplicationSchema = new mongoose.Schema(
  {
    personal: {
      firstName: { type: String },
      middleName: { type: String },
      lastName: { type: String },
      address: { type: String },
      city: { type: String },
      state: { type: String },
      zipCode: { type: String },
      email: { type: String },
      phoneNumber: { type: String },
      vendorRole: { type: String },
      referralSalesId: { type: String },
      termsAccepted: { type: Boolean },
    },
    business: {
      businessName: { type: String },
      businessType: { type: String },
      businessCategory: { type: String },
      businessAddress: { type: String },
      businessPhoneNumber: { type: String },
      typeofoffering: { type: String },
      website: { type: String },
      yearEstablished: { type: String },
      taxId: { type: String },
    },
    documents: {
      userIdImageUrl: { type: String },
      userIdImagePublicId: { type: String },
      businessRegImageUrl: { type: String },
      businessRegImagePublicId: { type: String },
      logoUrl: { type: String },
      logoPublicId: { type: String },
    },
    pdfUrl: { type: String },
    pdfPublicId: { type: String },
    submittedAt: { type: Date },
  },
  { _id: false },
);

/* =======================
   Main User Schema
======================= */

const userSchema = new mongoose.Schema<IUser>(
  {
    // Basic fields
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },

    password: {
      type: String,
      required: function (this: { authProvider?: string }) {
        return this.authProvider === "local";
      },
    },

    vendorDashboardPassword: {
      type: String,
    },

    mobileNumber: { type: String },
    profileImage: { type: String },

    // Auth
    role: {
      type: String,
      enum: ["user", "admin", "vendor"],
      default: "user",
    },

    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    // Admin OTP
    adminOtp: { type: String },
    adminOtpExpires: { type: Date },
    adminOtpSentAt: { type: Date },

    // Email OTP
    emailOtp: { type: String },
    emailOtpExpires: { type: Date },
    emailOtpSentAt: { type: Date },

    // Vendor flow
    vendorStatus: {
      type: String,
      enum: ["NEW", "PENDING", "APPROVED", "REJECTED"],
      default: function (this: { role?: string }) {
        return this.role === "vendor" ? "NEW" : undefined;
      },
    },

    // Optional admin-provided rejection reason to show to vendor
    vendorRejectionReason: { type: String },

    vendorInfo: vendorInfoSchema,
    vendorApproval: vendorApprovalSchema,
    vendorApplication: vendorApplicationSchema,

    vendorSubscription: {
      planKey: { type: String, enum: ["bronze", "silver", "gold"] },
      status: { type: String },
      currentPeriodEnd: { type: Date },
      cancelAtPeriodEnd: { type: Boolean },
      stripeCustomerId: { type: String },
      stripeSubscriptionId: { type: String },
      stripePriceId: { type: String },
    },
  },
  {
    timestamps: true,
  },
);

/* Indexes are derived from field definitions (unique: true).
  Avoid duplicate manual index() calls to prevent Mongoose warnings. */

/* =======================
   Hooks
======================= */

// Hash password before save
userSchema.pre("save", async function (next) {
  if (this.authProvider === "google") return next();

  const shouldHashPassword = this.isModified("password") && !!this.password;
  const shouldHashVendorDashboardPassword =
    this.isModified("vendorDashboardPassword") && !!this.vendorDashboardPassword;

  if (!shouldHashPassword && !shouldHashVendorDashboardPassword) return next();

  const salt = await bcrypt.genSalt(12);

  if (shouldHashPassword) {
    this.password = await bcrypt.hash(this.password as string, salt);
  }

  if (shouldHashVendorDashboardPassword) {
    this.vendorDashboardPassword = await bcrypt.hash(
      this.vendorDashboardPassword as string,
      salt,
    );
  }
  next();
});

/* =======================
   Methods
======================= */

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.compareVendorDashboardPassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.vendorDashboardPassword) return false;
  return bcrypt.compare(candidatePassword, this.vendorDashboardPassword);
};

/* =======================
   Export
======================= */

const User = mongoose.model<IUser>("User", userSchema);
export default User;
