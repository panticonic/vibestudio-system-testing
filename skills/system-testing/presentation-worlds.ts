import type {
  ComponentSpec,
  PresentationRequest,
} from "@workspace-skills/visualize/types";

type Display = {
  id: string;
  component: ComponentSpec;
  labels: string[];
};

type Disposition =
  | { id: string; status: "plain" }
  | {
      id: string;
      status: "deferred";
      component: "Calculator" | "Diagram" | "OneOff";
    }
  | { id: string; status: "needs-review"; reason: string };

export type PresentationWorld = {
  id: string;
  request: PresentationRequest;
  expected: (Display | Disposition)[];
  omitted: string[];
};

export const managedPresentationWorlds: PresentationWorld[] = [
  {
    id: "equipment-load",
    request: {
      goal: "Compare the benches first, then plot the incoming jobs. Skip the unrelated paint note.",
      sections: [
        {
          id: "jobs",
          required: true,
          ask: "Draw a line chart with day and jobs as the keys.",
          data: "Mon 24 jobs; Tue 38 jobs; Wed 31 jobs.",
        },
        {
          id: "benches",
          required: true,
          ask: "Compare the two benches by their sockets.",
          data: "East bench has 6 sockets; West bench has 10 sockets.",
        },
        {
          id: "paint",
          required: false,
          ask: "What color is the door?",
          data: "The door is turquoise.",
        },
      ],
    },
    expected: [
      {
        id: "benches",
        component: {
          component: "Compare",
          props: {
            options: [
              { name: "East bench", attributes: { sockets: 6 } },
              { name: "West bench", attributes: { sockets: 10 } },
            ],
          },
        },
        labels: ["East bench", "West bench", "sockets"],
      },
      {
        id: "jobs",
        component: {
          component: "Chart",
          props: {
            type: "line",
            x: "day",
            y: "jobs",
            data: [
              { day: "Mon", jobs: 24 },
              { day: "Tue", jobs: 38 },
              { day: "Wed", jobs: 31 },
            ],
          },
        },
        labels: ["Mon", "Tue", "Wed"],
      },
    ],
    omitted: ["paint"],
  },
  {
    id: "exhibit-installation",
    request: {
      goal: "Show the installation schedule, then the setup checklist.",
      sections: [
        {
          id: "setup",
          required: true,
          ask: "Show a checklist with these labels in order.",
          data: "Check mount screws; Test gallery light; Remove floor covers.",
        },
        {
          id: "schedule",
          required: true,
          ask: "Show a timeline with the stated times and titles.",
          data: "07:20 Delivery; 08:00 Art hanging; 09:45 Safety walkthrough.",
        },
      ],
    },
    expected: [
      {
        id: "schedule",
        component: {
          component: "Timeline",
          props: {
            items: [
              { time: "07:20", title: "Delivery" },
              { time: "08:00", title: "Art hanging" },
              { time: "09:45", title: "Safety walkthrough" },
            ],
          },
        },
        labels: ["07:20", "Art hanging", "Safety walkthrough"],
      },
      {
        id: "setup",
        component: {
          component: "Checklist",
          props: {
            items: [
              "Check mount screws",
              "Test gallery light",
              "Remove floor covers",
            ],
          },
        },
        labels: [
          "Check mount screws",
          "Test gallery light",
          "Remove floor covers",
        ],
      },
    ],
    omitted: [],
  },
  {
    id: "unsampled-hall",
    request: {
      goal: "Show the confirmed headline counts. Hold the hall comparison until capacity readings are available.",
      sections: [
        {
          id: "counts",
          required: true,
          ask: "Show both confirmed headline counts.",
          data: "Confirmed bookings: 24; Waitlisted: 9.",
        },
        {
          id: "halls",
          required: true,
          ask: "Compare the North and South halls by verified capacity.",
          data: "Neither North nor South hall capacity is confirmed.",
        },
      ],
    },
    expected: [
      {
        id: "counts",
        component: {
          component: "Stats",
          props: {
            items: [
              { label: "Confirmed bookings", value: 24 },
              { label: "Waitlisted", value: 9 },
            ],
          },
        },
        labels: ["Confirmed bookings", "24", "Waitlisted", "9"],
      },
      {
        id: "halls",
        status: "needs-review",
        reason: "The hall capacities are unconfirmed.",
      },
    ],
    omitted: [],
  },
  {
    id: "energy-readout",
    request: {
      goal: "State the reporting date, compare the current totals, then hand off the interactive cost calculator.",
      sections: [
        {
          id: "date",
          required: true,
          ask: "What is the reporting date?",
          data: "The reporting date is 18 November.",
        },
        {
          id: "totals",
          required: true,
          ask: "Show headline totals with their units.",
          data: "Grid: 23 kWh. Battery: 7 kWh.",
        },
        {
          id: "estimate",
          required: true,
          ask: "Let me vary the rate and see total cost change.",
          data: "Total cost equals energy used times cost per kWh.",
        },
      ],
    },
    expected: [
      { id: "date", status: "plain" },
      {
        id: "totals",
        component: {
          component: "Stats",
          props: {
            items: [
              { label: "Grid", value: "23 kWh" },
              { label: "Battery", value: "7 kWh" },
            ],
          },
        },
        labels: ["Grid", "23 kWh", "Battery", "7 kWh"],
      },
      { id: "estimate", status: "deferred", component: "Calculator" },
    ],
    omitted: [],
  },
];
