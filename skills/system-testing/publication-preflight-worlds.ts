type World = {
  id: string;
  goal: string;
  title: string;
  caption: string;
  requiredCaption: string;
  audience: string;
  expectedBlockers: string[];
  denyEntry?: boolean;
  anotherDestination?: boolean;
  checkExisting?: boolean;
};

export const managedPublicationWorlds: World[] = [
  {
    id: "review-ready",
    title: "Transit overview",
    caption: "Weekday departures in local time",
    requiredCaption: "Weekday departures in local time",
    audience: "Transit riders",
    goal: "Check the actual public package and rendered transit caption. Prepare a review decision for the preview.",
    expectedBlockers: [],
  },
  {
    id: "missing-caption",
    title: "Public service map",
    caption: "Weekday averages",
    requiredCaption: "Weekend closures shown separately",
    audience: "Weekend trip planners",
    goal: "Check whether the assigned preview explains weekend closures for its intended audience.",
    expectedBlockers: ["missing-presentation"],
  },
  {
    id: "unreviewed-entry",
    title: "Campus shuttle map",
    caption: "Stops shown in service order",
    requiredCaption: "Stops shown in service order",
    audience: "Campus visitors",
    goal: "Review the website package against exactly the approved public file inventory.",
    expectedBlockers: ["public-paths"],
    denyEntry: true,
  },
  {
    id: "different-destination",
    title: "Library hours",
    caption: "Holiday exceptions listed below",
    requiredCaption: "Holiday exceptions listed below",
    audience: "Library visitors",
    goal: "Review this package for the requested preview destination using the existing approved review intent.",
    expectedBlockers: ["different-request"],
    anotherDestination: true,
  },
  {
    id: "no-existing-receipt",
    title: "Trail notices",
    caption: "Check conditions before departure",
    requiredCaption: "Check conditions before departure",
    audience: "Trail visitors",
    goal: "Check whether the requested preview has a verified publication.",
    expectedBlockers: ["missing-publication"],
    checkExisting: true,
  },
  {
    id: "two-review-blockers",
    title: "Water-use guide",
    caption: "Monthly estimates",
    requiredCaption: "Figures are in liters per household",
    audience: "Public utility customers",
    goal: "Check the visible units and the complete approved file inventory in the assigned preview.",
    expectedBlockers: ["missing-presentation", "public-paths"],
    denyEntry: true,
  },
];
