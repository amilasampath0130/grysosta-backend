// backend/src/controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { generateNumericCode, generateTokenHex, hashToken } = require('../utils/tokens');
const { sendEmail } = require('../utils/email');

const VERIF_EXPIRES_MS = (Number(process.env.VERIFICATION_TOKEN_EXPIRES || 3600) * 1000);
const RESET_EXPIRES_MS = (Number(process.env.RESET_TOKEN_EXPIRES || 3600) * 1000);

function signJwt(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
}

exports.sendVerification = async (req, res) => {
  try {
    const { name, username, email, password, mobileNumber } = req.body;
    if (!email || !password || !username || !name) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // avoid creating duplicates if verified user exists
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing && existing.isVerified) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const code = generateNumericCode(6);
    const hashed = hashToken(code);
    const expiresAt = new Date(Date.now() + VERIF_EXPIRES_MS);

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name, username, email, password, mobileNumber, isVerified: false });
    } else {
      user.name = name;
      user.username = username;
      user.password = password;
      user.mobileNumber = mobileNumber;
    }

    user.verificationToken = hashed;
    user.verificationExpires = expiresAt;
    await user.save();

    const html = `<p>Your verification code is <strong>${code}</strong>. It expires in 1 hour.</p>`;
    await sendEmail(email, 'Verify your account', html);

    return res.json({ success: true, message: 'Verification code sent', data: { email } });
  } catch (err) {
    console.error('sendVerification error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyAndRegister = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success: false, message: 'Missing fields' });

    const user = await User.findOne({ email });
    if (!user || !user.verificationToken) return res.status(400).json({ success: false, message: 'No pending verification' });
    if (!user.verificationExpires || user.verificationExpires < new Date()) return res.status(400).json({ success: false, message: 'Verification code expired' });

    if (hashToken(code) !== user.verificationToken) return res.status(400).json({ success: false, message: 'Invalid code' });

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    const token = signJwt(user._id.toString());
    return res.json({ success: true, message: 'User verified', data: { token, user: { id: user._id, email: user.email, username: user.username } } });
  } catch (err) {
    console.error('verifyAndRegister error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Missing email' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'No pending verification' });

    const code = generateNumericCode(6);
    user.verificationToken = hashToken(code);
    user.verificationExpires = new Date(Date.now() + VERIF_EXPIRES_MS);
    await user.save();

    await sendEmail(email, 'Your verification code', `<p>Your verification code is <strong>${code}</strong>.</p>`);
    return res.json({ success: true, message: 'Verification code resent' });
  } catch (err) {
    console.error('resendVerification error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Missing email' });

    const user = await User.findOne({ email });
    // Always respond with success to avoid user enumeration
    if (!user) return res.json({ success: true, message: 'If the email exists, a reset link was sent.' });

    const token = generateTokenHex();
    user.resetPasswordToken = hashToken(token);
    user.resetPasswordExpires = new Date(Date.now() + RESET_EXPIRES_MS);
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    await sendEmail(email, 'Reset your password', `<p>Reset link: <a href="${resetLink}">${resetLink}</a></p>`);

    return res.json({ success: true, message: 'If the email exists, a reset link was sent.' });
  } catch (err) {
    console.error('requestPasswordReset error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields' });

    const user = await User.findOne({ email });
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    if (user.resetPasswordExpires < new Date()) return res.status(400).json({ success: false, message: 'Reset token expired' });

    if (hashToken(token) !== user.resetPasswordToken) return res.status(400).json({ success: false, message: 'Invalid token' });

    user.password = newPassword; // pre-save hook will hash
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
