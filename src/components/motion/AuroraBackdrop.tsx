import React from 'react';

export const AuroraBackdrop: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#f6f8ff]"
    >
      {/* Base cool light wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(160deg, #f8faff 0%, #f3f6ff 48%, #f4f9ff 100%)',
        }}
      />

      {/* Top-left electric blue + cyan aurora bloom */}
      <div
        className="aurora-orb-a absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 40% 40%, rgba(37, 99, 235, 0.14) 0%, rgba(6, 182, 212, 0.09) 48%, rgba(255, 255, 255, 0) 75%)',
        }}
      />

      {/* Top-right soft violet + electric blue aurora bloom */}
      <div
        className="aurora-orb-b absolute -top-28 -right-24 h-[32rem] w-[32rem] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 55% 45%, rgba(124, 58, 237, 0.13) 0%, rgba(37, 99, 235, 0.08) 52%, rgba(255, 255, 255, 0) 76%)',
        }}
      />

      {/* Subtle lower-center cyan-blue ambient glow */}
      <div
        className="absolute bottom-[-14rem] left-1/3 h-[28rem] w-[42rem] rounded-full opacity-45 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.1) 0%, rgba(124, 58, 237, 0.06) 50%, rgba(255, 255, 255, 0) 75%)',
        }}
      />
    </div>
  );
};
