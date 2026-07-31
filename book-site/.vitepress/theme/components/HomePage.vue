<script setup>
import { onMounted, ref } from 'vue'
import { getProgress } from '../lib/progress'

const last = ref(null)
const percent = ref(0)

onMounted(() => {
  const p = getProgress()
  last.value = p.last
  percent.value = p.percent
})
</script>

<template>
  <div class="z2p-home">
    <section class="z2p-hero" aria-label="Hero">
      <div class="z2p-hero__atmosphere" aria-hidden="true" />
      <div class="z2p-hero__content">
        <p class="z2p-hero__brand">Zero to Production</p>
        <h1 class="z2p-hero__headline">From first container to day-2 SRE</h1>
        <p class="z2p-hero__lede">
          A textbook that teaches Docker and Kubernetes the way a mentor would—
          plain English, then the mechanism, then how production teams actually run it.
        </p>
        <div class="z2p-hero__actions">
          <a class="z2p-btn z2p-btn--primary" href="/00-preface">Start the preface</a>
          <a
            v-if="last"
            class="z2p-btn z2p-btn--ghost"
            :href="last.href"
          >Resume · {{ percent }}%</a>
          <a
            v-else
            class="z2p-btn z2p-btn--ghost"
            href="/01-docker-why-and-what"
          >Jump to Chapter 01</a>
        </div>
      </div>
      <div class="z2p-hero__visual">
        <img
          src="/cover-mastering-docker-k8s.png"
          alt="Book cover: from container packaging to cluster orchestration"
          width="720"
          height="960"
        />
      </div>
    </section>

    <section class="z2p-paths" aria-label="Reading paths">
      <header class="z2p-section-head">
        <h2>Choose your path</h2>
        <p>Same book. Different depth. Pick where you begin—and let progress follow you.</p>
      </header>
      <div class="z2p-paths__grid">
        <a class="z2p-path" href="/01-docker-why-and-what">
          <span class="z2p-path__label">Beginner</span>
          <strong class="z2p-path__title">Docker foundation</strong>
          <span class="z2p-path__meta">Preface · Chapters 01–10</span>
        </a>
        <a class="z2p-path" href="/01-docker-why-and-what">
          <span class="z2p-path__label">Technical</span>
          <strong class="z2p-path__title">Ship on Kubernetes</strong>
          <span class="z2p-path__meta">Chapters 01–24</span>
        </a>
        <a class="z2p-path" href="/01-docker-why-and-what">
          <span class="z2p-path__label">DevOps / SRE</span>
          <strong class="z2p-path__title">Full production track</strong>
          <span class="z2p-path__meta">Chapters 01–33 + appendices</span>
        </a>
      </div>
    </section>

    <section class="z2p-method" aria-label="How to read">
      <header class="z2p-section-head">
        <h2>How every concept is taught</h2>
        <p>Three tiers. One habit. Never skip the production floor.</p>
      </header>
      <ol class="z2p-method__steps">
        <li>
          <span class="z2p-tier-chip z2p-tier-chip--plain">In plain terms</span>
          <p>Intuition and the problem being solved—before the jargon.</p>
        </li>
        <li>
          <span class="z2p-tier-chip z2p-tier-chip--hood">Under the hood</span>
          <p>Exact mechanism, commands, YAML, and what breaks if you get it wrong.</p>
        </li>
        <li>
          <span class="z2p-tier-chip z2p-tier-chip--prod">In production</span>
          <p>Ownership, blast radius, detection, and the decisions platform teams make.</p>
        </li>
      </ol>
    </section>
  </div>
</template>
