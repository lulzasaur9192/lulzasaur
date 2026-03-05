# Heartbeat Optimization Proposal

**Problem:** Token waste on unnecessary heartbeats during idle periods

## Current State Analysis

### Architecture
- **Scheduler:** Polls every 30s (`HEARTBEAT_POLL_INTERVAL_SECONDS`)
- **Agent field:** `heartbeatIntervalSeconds` (default: ~300s = 5 min)
- **Trigger:** `nextHeartbeatAt <= now AND status = 'idle'`
- **Cost:** ~1,000-2,000 tokens per heartbeat

### Token Waste Calculation

**Current Usage (main-orchestrator example):**
- Heartbeat interval: 5 minutes
- Heartbeats per day: 288
- Tokens per heartbeat: ~1,500 (avg)
- **Daily cost: ~432,000 tokens**
- **Weekly cost: ~3,024,000 tokens**

Most heartbeats during idle periods just check unchanged state and return "standing by."

## Proposed Solution: Context-Aware Scheduling

### Schedule Types by Agent Role

#### 1. **Trading Agents** (prop-shop, position-monitor)

**Market Hours** (Mon-Fri 7:00 AM - 1:30 PM PST):
- Interval: 15 minutes
- Reason: Active monitoring for signals, positions, risk events
- Heartbeats/day: 26
- Tokens/day: ~39,000

**After Hours** (Mon-Fri 1:30 PM - 7:00 AM):
- Interval: 2 hours
- Reason: Research, backtesting, data pipeline
- Heartbeats/day: 9
- Tokens/day: ~13,500

**Weekends**:
- Interval: 6 hours  
- Reason: User messages only, no market activity
- Heartbeats/day: 4
- Tokens/day: ~6,000

**Total: ~58,500 tokens/day (86% reduction)**

#### 2. **Orchestrator Agents** (main-orchestrator)

**Business Hours** (Mon-Fri 6 AM - 10 PM PST):
- Interval: 10 minutes
- Reason: User likely active, quick response needed
- Heartbeats/day: 96
- Tokens/day: ~144,000

**Off Hours**:
- Interval: 30 minutes
- Reason: Lower user activity, still responsive
- Heartbeats/day: 28
- Tokens/day: ~42,000

**Total: ~186,000 tokens/day (57% reduction)**

#### 3. **Research/Background Agents**

**Anytime**:
- Interval: 1-4 hours
- Reason: Long-running tasks, infrequent checks
- Heartbeats/day: 6-24
- Tokens/day: ~9,000-36,000

### Event-Driven Wakeups

In addition to scheduled heartbeats, agents wake immediately on:
- ✅ User message received
- ✅ Task assigned  
- ✅ Child agent sends message
- ✅ Critical system event (risk limit, error, etc.)

This ensures responsiveness while reducing polling.

## Implementation Phases

### Phase 1: Basic Schedule Configuration (Week 1)

**Changes:**
1. Add `schedules` array to soul.yaml:
   ```yaml
   schedules:
     - name: "market_hours"
       days: [1,2,3,4,5]  # Mon-Fri
       start_time: "07:00"
       end_time: "13:30"
       timezone: "America/Los_Angeles"
       interval_seconds: 900  # 15 min
     - name: "after_hours"
       days: [1,2,3,4,5]
       start_time: "13:30"
       end_time: "07:00"
       interval_seconds: 7200  # 2 hours
     - name: "weekends"
       days: [0,6]  # Sun, Sat
       interval_seconds: 21600  # 6 hours
   ```

2. Update `scheduler.ts` to check current schedule
3. Calculate `nextHeartbeatAt` based on active schedule

**Benefit:** Immediate 70-85% token reduction

### Phase 2: Event-Driven System (Week 2)

**Changes:**
1. Message bus triggers immediate heartbeat
2. Task assignment triggers immediate heartbeat
3. Inter-agent messages trigger recipient heartbeat
4. System events trigger relevant agent heartbeats

**Benefit:** Better responsiveness, fewer unnecessary polls

### Phase 3: Adaptive Intervals (Week 3)

**Changes:**
1. Track agent activity level
2. Reduce interval during high activity
3. Increase interval during low activity
4. Per-agent token budgets

**Benefit:** Self-optimizing based on actual usage patterns

### Phase 4: Smart Skipping (Week 4)

**Changes:**
1. Skip heartbeat if no changes since last check
2. Summarize multiple skipped heartbeats
3. Wake only when something actually changed

**Benefit:** Additional 20-30% reduction during stable periods

## Token Savings Projection

### Before Optimization
| Agent Type | Interval | Daily HB | Tokens/Day | Weekly Tokens |
|------------|----------|----------|------------|---------------|
| Orchestrator | 5 min | 288 | 432,000 | 3,024,000 |
| Trading (3) | 5 min | 864 | 1,296,000 | 9,072,000 |
| **Total** | | **1,152** | **1,728,000** | **12,096,000** |

### After Optimization (Phase 1)
| Agent Type | Avg Interval | Daily HB | Tokens/Day | Weekly Tokens |
|------------|--------------|----------|------------|---------------|
| Orchestrator | 15 min | 96 | 144,000 | 1,008,000 |
| Trading (3) | 45 min avg | 96 | 144,000 | 1,008,000 |
| **Total** | | **192** | **288,000** | **2,016,000** |

**Savings: 1,440,000 tokens/day (83% reduction)**
**Weekly savings: 10,080,000 tokens (83% reduction)**

### After Full Implementation (Phase 4)
**Estimated: 1,600,000 tokens/day saved (92% reduction)**

## Risks & Mitigations

**Risk 1:** Miss time-sensitive events during long intervals
- **Mitigation:** Event-driven wakeups for messages/tasks/alerts

**Risk 2:** Timezone issues for distributed users
- **Mitigation:** Store timezone in agent config, convert properly

**Risk 3:** Increased complexity in scheduler
- **Mitigation:** Good tests, gradual rollout, fallback to default

**Risk 4:** Agents sleeping during unexpected activity
- **Mitigation:** Always wake on user interaction, configurable overrides

## Rollout Plan

1. **Week 1:** Deploy Phase 1 to prop-shop agents only (low risk)
2. **Week 2:** Monitor savings, deploy to main-orchestrator
3. **Week 3:** Add event-driven system, expand to all agents
4. **Week 4:** Enable adaptive intervals, smart skipping

## Success Metrics

- ✅ Token usage reduced by 70%+ within 2 weeks
- ✅ No increase in user-perceived latency
- ✅ No missed critical events
- ✅ Agent responsiveness maintained or improved

## Configuration Examples

See `heartbeat-schedule-examples.yaml` for full examples.

---

**Recommendation:** Proceed with Phase 1 implementation immediately. Low risk, high reward.
