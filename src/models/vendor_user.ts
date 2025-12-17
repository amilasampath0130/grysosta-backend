import mongoose, { models, Schema } from "mongoose";

const userSchema = new Schema({
    name :{
        type:String,
        required:true

    },
    email:{
        type:String,
        required:true,
    },
    password:{
        type:String,
        required:true
    }

},{
    timestamps:true
})

const Vendor_User = models.Vendor_User||mongoose.model("Vendor_User",userSchema)
export default Vendor_User