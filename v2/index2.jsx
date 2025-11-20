import React, { useState, useEffect, useRef } from 'react';
import { motion, useScroll, useTransform, useInView, AnimatePresence } from 'framer-motion';
import { 
  Menu, X, ArrowRight, User, Clock, Search, Phone, MapPin, Mail,
  Smartphone, Laptop, Gamepad2, HardDrive
} from 'lucide-react';

// --- THEME CONFIGURATION ---
const theme = {
  colors: {
    primary: '#0066FF',
    deep: '#023E8A',
    teal: '#00B4D8',
    black: '#111111',
    white: '#FFFFFF',
    offWhite: '#F9F9F9',
  },
};

// --- CUSTOM SCHEMATIC ICONS (Vector Optimized) ---

const SchematicPhone = () => {
  const [device, setDevice] = useState('phone');

  useEffect(() => {
    const interval = setInterval(() => {
      setDevice(prev => prev === 'phone' ? 'tablet' : 'phone');
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <svg viewBox="0 0 100 200" className="w-full h-full vector-effect-non-scaling-stroke" aria-hidden="true">
      <AnimatePresence mode="wait">
        {device === 'phone' ? (
          <motion.g key="phone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <motion.path d="M20,20 h60 a8,8 0 0 1 8,8 v120 a8,8 0 0 1 -8,8 h-60 a8,8 0 0 1 -8,-8 v-120 a8,8 0 0 1 8,-8 z" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: "easeInOut" }} />
            <motion.path d="M40,20 v5 h20 v-5" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.5 }} />
            <motion.path d="M25,40 L50,65 L35,110 L80,100 M50,65 L80,50 L85,80 M35,110 L25,130" fill="none" stroke="currentColor" strokeWidth="1.5" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.5, delay: 0.8, ease: "easeOut" }} />
          </motion.g>
        ) : (
          <motion.g key="tablet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <motion.path d="M2,40 h96 a4,4 0 0 1 4,4 v120 a4,4 0 0 1 -4,4 h-96 a4,4 0 0 1 -4,-4 v-120 a4,4 0 0 1 4,-4 z" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: "easeInOut" }} />
            <motion.circle cx="50" cy="160" r="4" stroke="currentColor" strokeWidth="1" fill="none" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.5, delay: 0.8 }} />
            <motion.path d="M95,50 L60,80 L85,130 L20,120 M60,80 L30,60 L10,100 M85,130 L50,150" fill="none" stroke="currentColor" strokeWidth="1.5" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.8, delay: 1, ease: "easeOut" }} />
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
};

const SchematicLaptop = () => (
  <svg viewBox="0 0 200 150" className="w-full h-full vector-effect-non-scaling-stroke" aria-hidden="true">
    <motion.rect x="20" y="10" width="160" height="100" rx="5" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
    <motion.path d="M10,120 h180 l-10,20 h-160 z" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
    <motion.rect x="80" y="125" width="40" height="10" fill="none" stroke="currentColor" strokeWidth="1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} />
  </svg>
);

const SchematicConsole = () => (
  <svg viewBox="0 0 150 200" className="w-full h-full vector-effect-non-scaling-stroke" aria-hidden="true">
    <motion.path d="M40,10 C40,10 10,50 10,190 H140 C140,50 110,10 110,10" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
    <motion.rect x="55" y="20" width="40" height="170" fill="none" stroke="currentColor" strokeWidth="1" initial={{ height: 0 }} animate={{ height: 170 }} transition={{ duration: 0.8, delay: 0.5 }} />
    <motion.line x1="75" y1="30" x2="75" y2="180" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} />
  </svg>
);

const SchematicData = () => (
  <svg viewBox="0 0 200 200" className="w-full h-full vector-effect-non-scaling-stroke" aria-hidden="true">
    <motion.rect x="50" y="50" width="100" height="100" fill="none" stroke="currentColor" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
    {[...Array(8)].map((_, i) => ( <motion.line key={i} x1={50} y1={60 + i*12} x2={30} y2={60 + i*12} stroke="currentColor" strokeWidth="2" initial={{ x2: 50 }} animate={{ x2: 30 }} transition={{ delay: 0.5 + (i * 0.05) }} /> ))}
    {[...Array(8)].map((_, i) => ( <motion.line key={i+8} x1={150} y1={60 + i*12} x2={170} y2={60 + i*12} stroke="currentColor" strokeWidth="2" initial={{ x2: 150 }} animate={{ x2: 170 }} transition={{ delay: 0.5 + (i * 0.05) }} /> ))}
    <motion.path d="M80,80 h40 v40 h-40 z" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 }} style={{ transformOrigin: 'center' }} />
  </svg>
);

// --- OPTIMIZED SERVICE ROW ---
const ServiceRow = ({ id, title, message, specs, Schematic, link }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.a
      href={link}
      className="block border-t border-black group relative bg-white overflow-hidden tap-highlight-transparent"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative z-20 flex flex-col md:flex-row items-start md:items-center justify-between p-6 md:p-12 transition-colors duration-300 md:group-hover:text-white">
        
        {/* ID & Title */}
        <div className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-16 w-full md:w-auto">
          <span className="font-mono text-[10px] md:text-xs text-gray-400 md:group-hover:text-[#00B4D8] transition-colors">
            ( {id} )
          </span>
          <div>
            <h3 className="text-3xl md:text-6xl font-bold tracking-tighter md:group-hover:translate-x-4 transition-transform duration-500 ease-out">
              {title}
            </h3>
            {/* Message: Visible by default on mobile, hidden on desktop until hover */}
            <p className="font-mono text-[10px] md:text-sm text-[#0066FF] mt-1 md:mt-2 md:group-hover:text-white/80 transition-colors md:group-hover:translate-x-4 duration-500 delay-75">
              "{message}"
            </p>
          </div>
        </div>

        {/* Specs: Visible by default on mobile, hidden on desktop until hover */}
        <div className="mt-4 md:mt-0 font-mono text-[10px] md:text-xs text-left md:text-right text-gray-500 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-500 delay-100 md:text-gray-300">
          {specs.map((spec, i) => (
            <div key={i} className="mb-1 last:mb-0">+ {spec}</div>
          ))}
        </div>

        {/* Mobile Arrow */}
        <ArrowRight className="md:hidden absolute right-6 top-8 w-5 h-5 -rotate-45 text-gray-400" />
      </div>

      {/* Background Hover Effect: Only active on Desktop (md:) */}
      <div className="absolute inset-0 z-10 bg-[#111] translate-y-full md:group-hover:translate-y-0 transition-transform duration-500 ease-in-out hidden md:block" />
      
      {/* Schematic: Visible (low opacity) on Mobile, Reveal on Hover on Desktop */}
      <div className="absolute right-[-20px] md:right-1/3 top-1/2 -translate-y-1/2 w-24 h-24 md:w-48 md:h-48 z-10 pointer-events-none opacity-10 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-500 text-black md:text-white/30">
        {(isHovered || window.innerWidth < 768) && <Schematic />}
      </div>
    </motion.a>
  );
};

const AnimatedCounter = ({ target, suffix = '', duration = 2 }) => {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-20px" }); // Tighter margin for mobile

  useEffect(() => {
    if (!isInView) return;
    let startTime;
    const start = 0;
    const end = parseFloat(target);
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      const ease = 1 - (1 - progress) * (1 - progress);
      const current = start + (end - start) * ease;
      setCount(current);
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }, [isInView, target, duration]);

  const formatted = target % 1 !== 0 ? count.toFixed(1) : Math.floor(count);
  return <span ref={ref}>{formatted}{suffix}</span>;
};

const Marquee = () => (
  <div className="border-y border-black py-2 md:py-3 overflow-hidden whitespace-nowrap bg-white relative">
    <div className="absolute inset-0 bg-gradient-to-r from-[#023E8A] via-[#0066FF] to-[#00B4D8] opacity-100" />
    <motion.div 
      className="inline-block text-white font-mono text-[10px] md:text-sm tracking-widest relative z-10"
      animate={{ x: [0, -1000] }}
      transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
    >
      IPHONE REPAIR — MACBOOK RESTORATION — CONSOLE DIAGNOSTICS — DATA RECOVERY — GUILDFORD — ONE MAN OPERATION — 5 STAR RATED — OPEN DAILY — IPHONE REPAIR — MACBOOK RESTORATION — CONSOLE DIAGNOSTICS — DATA RECOVERY — GUILDFORD — ONE MAN OPERATION — 5 STAR RATED — OPEN DAILY — 
    </motion.div>
  </div>
);

const ReviewSlider = () => {
  const reviews = [
    { name: "ALEX T.", device: "MACBOOK PRO", issue: "LIQUID DAMAGE", text: "Thought my MacBook was dead forever. Tomas didn't just fix it; he resurrected it. The attention to detail is unlike any repair shop I've used before." },
    { name: "SARAH M.", device: "LAPTOP", issue: "SCREEN REPLACEMENT", text: "Excellent service! Tomas fixed my laptop screen in just 2 hours. Professional, affordable, and reliable. Highly recommended!" },
    { name: "MICHAEL R.", device: "PS5", issue: "OVERHEATING", text: "The only place I trust with my gaming rig. Honest pricing and technical wizardry. My PS5 runs quieter than the day I bought it." }
  ];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((p) => (p + 1) % reviews.length), 5000); // Slowed down slightly for mobile reading
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="relative h-80 md:h-64 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0"
        >
          <blockquote className="text-lg md:text-3xl font-bold leading-tight mb-6 md:mb-8">"{reviews[index].text}"</blockquote>
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 font-mono text-xs md:text-sm">
            <span className="text-[#00B4D8]">— {reviews[index].name}</span>
            <span className="text-gray-500">{reviews[index].device} • {reviews[index].issue}</span>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-0 right-0 flex gap-2">
        {reviews.map((_, i) => (
          <div key={i} className={`h-1 w-6 md:w-8 transition-colors duration-300 ${i === index ? 'bg-[#00B4D8]' : 'bg-gray-800'}`} />
        ))}
      </div>
    </div>
  );
};

export default function Homepage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F9F9F9] text-[#111111] font-sans selection:bg-[#0066FF] selection:text-white overflow-x-hidden">
      
      {/* Grid Background */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-30"
        style={{
          backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-md border-b border-black z-50 h-16 px-6 md:px-12 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <span className="font-mono font-bold text-lg tracking-tighter text-[#023E8A]">ONLINEFIX</span>
          <span className="hidden md:inline-block text-xs font-mono text-gray-500">GUILDFORD, UK</span>
        </div>
        <div className="hidden md:flex items-center gap-8 font-mono text-xs">
          {['SERVICES', 'ABOUT', 'TRACKING'].map((item) => (
            <a key={item} href={`#${item.toLowerCase()}`} className="hover:text-[#0066FF] transition-colors relative group">
              {item}
              <span className="absolute -bottom-1 left-0 w-0 h-px bg-[#0066FF] transition-all group-hover:w-full" />
            </a>
          ))}
          <a href="#contact" className="bg-black text-white px-4 py-2 hover:bg-[#0066FF] transition-colors">CONTACT</a>
        </div>
        <button className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center" onClick={() => setIsMenuOpen(!isMenuOpen)}>
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.3 }}
            className="fixed inset-0 bg-white z-40 pt-24 px-6 border-l border-black md:hidden"
          >
            <div className="flex flex-col gap-8 font-mono text-2xl">
              {['HOME', 'SERVICES', 'ABOUT', 'TRACKING'].map(item => (
                <a key={item} href="#" className="border-b border-gray-100 pb-4 block" onClick={() => setIsMenuOpen(false)}>{item}</a>
              ))}
              <a href="#" className="text-[#0066FF] block" onClick={() => setIsMenuOpen(false)}>CONTACT</a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero */}
      <header className="relative pt-24 md:pt-32 pb-12 md:pb-20 px-6 md:px-12 max-w-[1600px] mx-auto min-h-[85vh] md:min-h-[90vh] flex items-end">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12 w-full items-end relative z-10">
          <div className="lg:col-span-8">
            <h1 className="text-4xl md:text-8xl lg:text-9xl font-bold leading-[0.95] md:leading-[0.9] tracking-tighter mb-6 md:mb-8 break-words">
              YOUR DEVICE.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#023E8A] via-[#0066FF] to-[#00B4D8]">LIKE NEW.</span>
            </h1>
            <div className="font-mono text-xs md:text-sm border-l-2 border-[#0066FF] pl-4 mb-8 md:mb-12 max-w-md">
              <p>Restoring the connection between human and machine.</p>
              <p>Hand-crafted repairs by Tomas.</p>
              <p>Located in Guildford.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <a href="#" className="bg-black text-white font-mono px-8 py-4 text-center hover:bg-[#0066FF] transition-colors shadow-lg text-sm md:text-base">"INITIATE REPAIR"</a>
              <a href="#" className="hidden md:block border border-black bg-white text-black font-mono px-8 py-4 text-center hover:bg-black hover:text-white transition-colors text-sm md:text-base">"WHAT WE DO"</a>
            </div>
          </div>
          <div className="lg:col-span-4 relative mt-8 md:mt-12 lg:mt-0 flex flex-col items-center lg:block">
            <motion.div className="aspect-[3/4] border-2 border-black bg-white p-4 relative shadow-[10px_10px_0px_0px_rgba(2,62,138,1)] w-full max-w-xs mx-auto"
              whileHover={{ y: -5, boxShadow: '15px 15px 0px 0px rgba(2,62,138,1)' }}>
              <div className="absolute top-4 right-4 font-mono text-xs text-[#0066FF]">ITEM 01</div>
              <div className="h-full w-full border border-dashed border-gray-300 flex items-center justify-center relative overflow-hidden bg-gray-50">
                <Smartphone className="w-32 h-32 md:w-48 md:h-48 text-gray-200 absolute transform -rotate-12 scale-150" strokeWidth={1} />
                <div className="relative z-10 text-center bg-white/80 backdrop-blur-sm p-4 border border-black">
                  <div className="text-3xl md:text-4xl font-bold mb-2 text-[#023E8A]">"BROKEN"</div>
                  <div className="h-px w-16 bg-black mx-auto my-2"></div>
                  <div className="font-mono text-[10px] text-gray-500">STATUS: CRITICAL</div>
                </div>
              </div>
            </motion.div>
            <div className="mt-6 w-full max-w-xs md:hidden">
                <a href="#" className="block w-full border border-black bg-white text-black font-mono px-6 py-3 text-center hover:bg-black hover:text-white transition-colors text-sm">"WHAT WE DO"</a>
            </div>
          </div>
        </div>
      </header>

      <Marquee />

      {/* Philosophy */}
      <section className="py-16 md:py-24 px-6 md:px-12 bg-white border-b border-black">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-6xl font-bold tracking-tight mb-8">
            Ideally, it just works.<br />
            When it doesn't, <span className="bg-[#0066FF] text-white px-2 inline-block transform -rotate-1">we fix it.</span>
          </h2>
          <p className="text-base md:text-lg text-gray-600 leading-relaxed mb-12 md:mb-16 font-light max-w-2xl mx-auto">
            We believe a device isn't disposable. It's an archive of your memories. We don't just replace parts. We restore functionality with surgical precision.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center border-t border-black pt-12">
            {[
              { icon: User, title: "ONE ENGINEER", desc: "No assembly lines. Just Tomas handling your device start to finish." },
              { icon: Clock, title: "SPEED IS A FEATURE", desc: "We understand downtime anxiety. Most repairs done same-day." },
              { icon: Search, title: "TRANSPARENCY", desc: "Diagnostic reports in plain English. Pricing discussed upfront." }
            ].map((item, i) => (
              <div key={i} className="group">
                <item.icon className="w-8 h-8 mx-auto mb-4 text-[#023E8A] group-hover:scale-110 transition-transform" />
                <h3 className="font-mono font-bold text-lg mb-2">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEW SERVICES SECTION: TECHNICAL MANIFEST */}
      <section className="py-16 md:py-24 px-6 md:px-12 bg-[#F5F5F5]" id="services">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex justify-between items-end mb-8 md:mb-12 border-b border-black pb-4">
            <h2 className="font-mono text-xs md:text-base uppercase tracking-widest text-[#023E8A]">
              Catalogue of Services
            </h2>
            <span className="font-mono text-[10px] md:text-xs text-gray-500">V.2025 // MANIFEST</span>
          </div>

          <div className="border-b border-black">
            <ServiceRow 
              id="001" 
              title="HANDHELD" 
              message="GLASS IS TEMPORARY."
              specs={["OLED & LCD SCREENS", "ENERGY CELLS (BATTERY)", "CHARGE PORT ASSEMBLY", "WATER DISPLACEMENT"]} 
              Schematic={SchematicPhone}
              link="/iphone-repair-guildford.html"
            />
            <ServiceRow 
              id="002" 
              title="PLATFORM" 
              message="RETURN TO THE LOBBY."
              specs={["HDMI PORT REINFORCEMENT", "THERMAL PASTE APPLICATION", "OPTICAL DRIVE ALIGNMENT", "DRIFT CORRECTION"]} 
              Schematic={SchematicConsole}
              link="/console-repair-guildford.html"
            />
            <ServiceRow 
              id="003" 
              title="WORKSTATION" 
              message="HARDWARE IS FOREVER."
              specs={["LOGIC BOARD REPAIR", "THERMAL ARCHITECTURE", "LIQUID DAMAGE REVERSAL", "DISPLAY ASSEMBLY"]} 
              Schematic={SchematicLaptop}
              link="/macbook-repair-guildford.html"
            />
            <ServiceRow 
              id="004" 
              title="RECOVERY" 
              message="IT'S NOT GONE YET."
              specs={["FORENSIC RETRIEVAL", "MECHANICAL DRIVE FAILURE", "SECURE TRANSFER", "NO DATA NO FEE"]} 
              Schematic={SchematicData}
              link="/data-recovery-services.html"
            />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 md:py-20 px-6 md:px-12 bg-white border-y border-black">
        <div className="max-w-[1600px] mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
          {[
            { val: 500, suffix: "+", label: "Units Repaired", color: "text-[#0066FF]" },
            { val: 98, suffix: "%", label: "Success Rate", color: "text-[#023E8A]" },
            { val: 24, suffix: "H", label: "Avg. Turnaround", color: "text-[#0066FF]" },
            { val: 5.0, suffix: "", label: "Google Rating", color: "text-[#023E8A]" }
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <div className={`text-4xl md:text-7xl font-bold tracking-tighter mb-2 ${stat.color}`}>
                <AnimatedCounter target={stat.val} suffix={stat.suffix} />
              </div>
              <div className="font-mono text-[10px] md:text-xs text-gray-500 uppercase tracking-widest">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Reviews */}
      <section className="py-16 md:py-24 px-6 md:px-12 bg-[#111] text-white overflow-hidden">
        <div className="max-w-4xl mx-auto relative">
          <div className="font-mono text-xs text-[#00B4D8] mb-8 md:mb-12">/// TESTIMONIAL ARCHIVE</div>
          <ReviewSlider />
          <div className="mt-12 md:mt-16 flex flex-col md:flex-row justify-between items-center gap-6 border-t border-gray-800 pt-8">
            <div className="text-xs font-mono text-gray-400 flex items-center gap-2">
              READING FROM GOOGLE
              <span className="flex gap-1">
                {[0, 0.2, 0.4].map((d, i) => (
                  <motion.span key={i} animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: d }}>.</motion.span>
                ))}
              </span>
            </div>
            <a href="#" className="group flex items-center gap-4 bg-gradient-to-r from-[#023E8A] via-[#0066FF] to-[#00B4D8] text-white px-6 py-3 hover:opacity-90 transition-all shadow-lg shadow-blue-900/20">
              <div className="bg-white rounded-full p-1"><div className="w-4 h-4 bg-blue-500 rounded-full"></div></div>
              <div className="text-left">
                <div className="font-bold text-xs tracking-wide">VIEW ON GOOGLE</div>
                <div className="font-mono text-[10px] text-white/90">VERIFIED ARCHIVE</div>
              </div>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-black pt-12 md:pt-16 pb-8 px-6 md:px-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-2">
            <a href="#" className="font-mono font-bold text-xl md:text-2xl tracking-tighter block mb-4 md:mb-6 text-[#023E8A]">ONLINEFIX</a>
            <p className="font-mono text-xs text-gray-600 max-w-xs mb-6">Independent electronics repair atelier based in Guildford, Surrey.</p>
          </div>
          <div>
            <h4 className="font-mono font-bold mb-4 md:mb-6 text-xs uppercase text-gray-400">Sitemap</h4>
            <ul className="space-y-2 md:space-y-3 font-mono text-xs">
              {['HOME', 'SERVICES', 'ABOUT', 'REVIEWS', 'TRACK REPAIR'].map(item => (
                <li key={item}><a href="#" className="hover:text-[#0066FF]">{item}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-mono font-bold mb-4 md:mb-6 text-xs uppercase text-gray-400">Contact</h4>
            <ul className="space-y-2 md:space-y-3 font-mono text-xs">
              <li className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#00B4D8]" /> 07940 730537</li>
              <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-[#00B4D8]" /> hello@onlinefix.uk</li>
              <li className="flex items-center gap-2"><MapPin className="w-4 h-4 text-[#00B4D8]" /> Guildford, GU1 4PD</li>
              <li className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#00B4D8]" /> 10 AM - 10 PM</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-200 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 font-mono text-[10px] text-gray-500">
          <div>© 2025 ONLINEFIX. ALL RIGHTS RESERVED.</div>
          <div className="flex gap-6"><span>PRIVACY</span><span>TERMS</span><span>"FIXED"</span></div>
        </div>
      </footer>
    </div>
  );
}
