// Simplified email service that logs to console instead of sending emails
class EmailService {
  async sendVerificationEmail(email, verificationCode) {
    try {
      console.log('📧 VERIFICATION CODE:', {
        email,
        verificationCode,
        message: 'In production, this would be sent via email'
      });
      
      // Simulate email delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`✅ Verification code ${verificationCode} generated for: ${email}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error in email service:', error);
      return { success: false, error: error.message };
    }
  }
}

export const emailService = new EmailService();