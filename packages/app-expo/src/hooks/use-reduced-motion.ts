import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Stay static until the OS preference is known; honor live accessibility changes. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let current = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      if (current) setReduced(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (current && !changed) setReduced(value);
      })
      .catch(() => {});
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
