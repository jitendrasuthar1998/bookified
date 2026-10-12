import {auth} from "@clerk/nextjs/server";
import {PLANS, PLAN_LIMITS, PlanType} from "@/lib/subscription-constants";

export const getUserPlan = async (): Promise<PlanType> => {
    const { has, userId } = await auth();

    if (!userId) return PLANS.FREE;

    // Default to PRO in development so users have unlimited books and sessions
    return PLANS.PRO;
}

export const getPlanLimits = async () => {
    const plan = await getUserPlan();
    return PLAN_LIMITS[plan];
}
