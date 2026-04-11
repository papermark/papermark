import { useRouter } from "next/router";

import { motion } from "motion/react";

import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";

import { Button } from "../ui/button";

export default function Dataroom() {
  const router = useRouter();
  return (
    <motion.div
      className="z-10 mx-5 flex flex-col items-center space-y-10 text-center sm:mx-auto"
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        show: {
          opacity: 1,
          scale: 1,
          transition: {
            staggerChildren: 0.2,
          },
        },
      }}
      initial="hidden"
      animate="show"
      exit="hidden"
      transition={{ duration: 0.3, type: "spring" }}
    >
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="flex flex-col items-center space-y-10 text-center"
      >
        <p className="text-2xl font-bold tracking-tighter text-foreground">
          Papermark
        </p>
        <h1 className="font-display max-w-xl text-3xl font-semibold transition-colors sm:text-4xl">
          Get started with data rooms!
        </h1>
      </motion.div>
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="mx-auto mt-24 w-full"
      >
        <video
          width="100%"
          id="video1"
          style={{ borderRadius: "6px" }}
          aria-hidden="true"
          playsInline
          autoPlay
          muted
          loop
          controls
        >
          <source
            src="https://img.papermarkassets.com/upload/file_EwRRKYFSgWcxPjGYF31QWe-Create-data-room-product-video-2.mp4"
            type="video/mp4"
          />
        </video>
      </motion.div>
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="mt-10 flex flex-col items-center space-y-4 text-center"
      >
        <Button
          className="px-10 text-base font-medium"
          onClick={() =>
            router.push({
              pathname: "/welcome",
              query: {
                type: "dataroom-trial",
              },
            })
          }
        >
          Get a data room trial
        </Button>
        <span className="text-xs text-muted-foreground">
          Data rooms are available on our `Data Rooms` plans and on the
          `Business` plan. <br />
          You receive a 7-day trial.
        </span>
      </motion.div>
    </motion.div>
  );
}
