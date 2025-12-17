import Vendor_User from "../models/vendor_user";
import jwt from "jsonwebtoken";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || "secret", {
    expiresIn: "7d",
  });
};

export const createVendorUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const existingUser = await Vendor_User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    const vendor_user = new Vendor_User({
      name,
      email,
      password, // ideally hash it with bcrypt
      lastlogin: new Date(),
    });

    await vendor_user.save();

    const token = generateToken(vendor_user._id);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        token,
        vendor_user: {
          id: vendor_user._id,
          name: vendor_user.name,
          email: vendor_user.email,
          lastlogin: vendor_user.lastlogin,
          createdAt: vendor_user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Error in register route:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
export default router;
