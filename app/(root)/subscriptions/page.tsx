import Link from "next/link";
import { Check, Sparkles, BookOpen, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserPlan } from "@/lib/subscription.server";
import { PLANS, PLAN_LIMITS } from "@/lib/subscription-constants";

export default async function SubscriptionsPage() {
  const currentPlan = await getUserPlan();

  const plans = [
    {
      id: PLANS.FREE,
      name: "Free Explorer",
      tagline: "Perfect for testing interactive AI voice reading.",
      price: "$0",
      period: "forever",
      isPopular: false,
      features: [
        `${PLAN_LIMITS.free.maxBooks} Book in your library`,
        `${PLAN_LIMITS.free.maxSessionsPerMonth} Voice sessions / month`,
        `${PLAN_LIMITS.free.maxDurationPerSession} Minutes max per session`,
        "Natural conversational AI",
        "PDF text segmentation & search",
      ],
      ctaText: currentPlan === PLANS.FREE ? "Current Plan" : "Get Started",
      ctaHref: "/books/new",
      isCurrent: currentPlan === PLANS.FREE,
    },
    {
      id: PLANS.STANDARD,
      name: "Avid Reader",
      tagline: "For active readers who love discussing books regularly.",
      price: "$9",
      period: "/ month",
      isPopular: true,
      features: [
        `Up to ${PLAN_LIMITS.standard.maxBooks} Books in library`,
        `${PLAN_LIMITS.standard.maxSessionsPerMonth} Voice sessions / month`,
        `${PLAN_LIMITS.standard.maxDurationPerSession} Minutes per session`,
        "Voice session history & summaries",
        "All voice personas (Dave, Daniel, Rachel, etc.)",
        "Fast response time",
      ],
      ctaText: currentPlan === PLANS.STANDARD ? "Current Plan" : "Start Standard",
      ctaHref: "/books/new",
      isCurrent: currentPlan === PLANS.STANDARD,
    },
    {
      id: PLANS.PRO,
      name: "Literary Scholar",
      tagline: "Unlimited conversational depth for serious learners.",
      price: "$19",
      period: "/ month",
      isPopular: false,
      features: [
        `Up to ${PLAN_LIMITS.pro.maxBooks} Books in library`,
        "Unlimited voice sessions",
        `${PLAN_LIMITS.pro.maxDurationPerSession} Minutes per session`,
        "Full session history & transcripts",
        "Priority voice synthesis",
        "Early access to new companion personas",
      ],
      ctaText: currentPlan === PLANS.PRO ? "Current Plan" : "Go Unlimited",
      ctaHref: "/books/new",
      isCurrent: currentPlan === PLANS.PRO,
    },
  ];

  return (
    <div className="container wrapper py-12 md:py-20 max-w-6xl mx-auto">
      <div className="flex flex-col items-center text-center mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#212a3b]/5 text-[#212a3b] text-xs font-semibold mb-4 border border-[#212a3b]/10">
          <Sparkles className="size-3.5" />
          <span>Flexible Reading Plans</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold font-serif text-[#212a3b] tracking-tight mb-4">
          Choose Your Reading Companion
        </h1>
        <p className="text-[#3d485e] max-w-2xl text-base sm:text-lg leading-relaxed">
          Upgrade your library to unlock longer voice discussions, multiple book personas, and deep interactive summaries.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col justify-between p-8 rounded-2xl bg-white transition-all duration-200 ${
              plan.isPopular
                ? "border-2 border-[#212a3b] shadow-xl md:-translate-y-2"
                : "border border-black/10 shadow-sm hover:shadow-md"
            }`}
          >
            {plan.isPopular && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#212a3b] text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                Most Popular
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold font-serif text-[#212a3b]">
                  {plan.name}
                </h3>
                {plan.isCurrent && (
                  <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Active
                  </span>
                )}
              </div>

              <p className="text-sm text-[#777] min-h-[40px] leading-relaxed mb-6">
                {plan.tagline}
              </p>

              <div className="flex items-baseline gap-1 mb-8 pb-6 border-b border-gray-100">
                <span className="text-4xl sm:text-5xl font-bold text-[#212a3b] tracking-tight">
                  {plan.price}
                </span>
                <span className="text-[#777] text-sm font-medium">
                  {plan.period}
                </span>
              </div>

              <div className="space-y-3.5 mb-8">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#212a3b]">
                  What's included:
                </p>
                {plan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="size-3.5 stroke-[2.5]" />
                    </div>
                    <span className="text-sm text-[#3d485e] leading-snug">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              asChild
              variant={plan.isPopular ? "default" : "outline"}
              className={`w-full h-11 text-sm font-semibold rounded-xl transition-all ${
                plan.isPopular
                  ? "bg-[#212a3b] text-white hover:bg-[#2b374d]"
                  : "border-gray-300 text-[#212a3b] hover:bg-gray-50"
              }`}
            >
              <Link href={plan.ctaHref}>
                {plan.ctaText}
              </Link>
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-16 text-center text-sm text-[#777]">
        Need help choosing? You can switch or test plans anytime during development.
      </div>
    </div>
  );
}
