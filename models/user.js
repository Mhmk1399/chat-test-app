import mongoose from "mongoose";
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "user", "superadmin", "consultant"],
      default: "user",
    },
    favorite: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Poster",
      },
    ],
    currentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      default: null,
      required: false,
    },
    planExpireDate: {
      type: Date,
      default: null,
      required: false,
    },
    meta: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);
export default mongoose.models.User || mongoose.model("User", userSchema);
