import asyncio,time

async def publish(state,clients):
    loop=asyncio.get_running_loop(); deadline=loop.time()
    while True:
        deadline+=.02
        await asyncio.sleep(max(0,deadline-loop.time()))
        now=loop.time()
        if now-deadline>=.02:
            missed=int((now-deadline)/.02);state.metrics['missed_deadlines']+=missed;deadline+=missed*.02
        state.seq+=1;packet=state.snapshot();state.metrics['published']+=1
        for q in tuple(clients):
            if q.full(): q.get_nowait();state.metrics['slow_drops']+=1
            q.put_nowait(packet)
