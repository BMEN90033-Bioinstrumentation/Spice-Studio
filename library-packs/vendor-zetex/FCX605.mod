*
*Zetex FCX605 Spice Model v1.0 Last revision 27/04/05
*
.SUBCKT FCX605 1 2 3
*              C B E
Q1 1 2 4 SUB605
Q2 1 4 3 SUB605 3.46
*
.MODEL SUB605 NPN IS=4.8E-14 BF=170 VAF=542 NF=1.0039 IKF=0.2 ISE=1.5E-14
+NE=1.55 BR=12 VAR=20 NR=1.007 IKR=0.35 ISC=7.486E-14 NC=1.0984 RB=0.17 RE=0.3
+RC=0.14 CJE=81E-12 CJC=10.8E-12 VJC=0.58 MJC=0.41 TF=1.024E-9 TR=700E-9
.ENDS FCX605
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
